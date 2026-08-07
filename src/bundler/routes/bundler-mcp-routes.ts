/**
 * Bundler MCP Routes - StreamableHTTP transport for MCP protocol
 *
 * Implements the MCP StreamableHTTP transport specification (2025-03-26) for
 * client connections to the bundler. Handles session management, authentication,
 * and request routing through a single /mcp endpoint.
 *
 * Endpoints:
 * - POST /mcp - Send MCP messages (initialize, requests, notifications)
 * - GET  /mcp - Open SSE stream for server-initiated messages
 * - DELETE /mcp - Terminate session
 *
 * Authentication: Bearer token in Authorization header, resolved via bundle resolver.
 * Rate limiting: 10 connections per IP per 15 minutes.
 *
 * Session Flow:
 * 1. Client POST with initialize request (no session ID) + Bearer token
 * 2. Server validates token, resolves bundle, creates session
 * 3. Server returns initialize response with mcp-session-id header
 * 4. Client includes mcp-session-id on all subsequent requests
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { BundlerServer } from "../core/bundler.js";
import { SESSION_EVENTS } from "../core/session/session.js";
import { LoadingStrategy } from "../core/session/loading/loading-strategy.js";
import { SessionIdentityResolver, TransportHeaderSessionIdentity } from "../core/session/session-identity.js";
import logger from "../../shared/utils/logger.js";
import { getPrometheusMetrics } from "../utils/metrics.js";
import { register } from "prom-client";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Bundle } from "../core/schemas.js";

/**
 * Transport metadata for session tracking
 */
interface TransportMeta {
  transport: StreamableHTTPServerTransport;
  mcpServer: Server;
  bundleId: string;
  createdAt: number;
}

/**
 * Create MCP routes with StreamableHTTP transport
 *
 * @param bundler The bundler server instance
 * @returns Express router with /mcp endpoint
 */
export function createMcpRoutes(bundler: BundlerServer): Router {
  const router = Router();
  const startupGracePeriodMs = 1000;
  const sessionIdentity: SessionIdentityResolver = new TransportHeaderSessionIdentity();

  // Store transport metadata by session ID (sessions stored in bundler.getSessions())
  const transportMeta = new Map<string, TransportMeta>();

  // Rate limiter for connection attempts
  const mcpLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minutes
    max: 100, // 10 connections per IP per window
    message: {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Too many connection attempts, please try again later" },
      id: null
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * Extract bearer token from Authorization header
   */
  function extractBearerToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }
    return authHeader.substring(7);
  }

  /**
   * Validate Accept header contains required content types
   */
  function validateAcceptHeader(req: Request): boolean {
    const accept = req.headers.accept || "";
    return accept.includes("application/json") && accept.includes("text/event-stream");
  }

  /**
   * Clean up a session and its resources.
   * Removes from maps BEFORE calling close() to prevent infinite recursion
   * (session.close() emits SHUTDOWN which would call cleanupSession again).
   */
  async function cleanupSession(sessionId: string): Promise<void> {
    const session = bundler.getSession(sessionId);

    // Remove from registry FIRST to prevent re-entry
    bundler.removeSession(sessionId);
    transportMeta.delete(sessionId);

    if (session) {
      try {
        await session.close();
      } catch (error: any) {
        logger.warn({ error: error.message, sessionId }, "Error closing session during cleanup");
      }
    }

    logger.debug({ sessionId }, "Session cleaned up");
  }

  /**
   * Wire up a session's domain object, middleware, and upstream connections
   * for a resolved bundle, and register it with the bundler and transport
   * registries.
   *
   * Deliberately independent of how sessionId/bundleConfig/token were
   * obtained - today's only caller is the StreamableHTTP initialize
   * handshake (onsessioninitialized below), but the MCP spec revision that
   * drops the handshake and Mcp-Session-Id header (see session-identity.ts)
   * will need to establish sessions from an explicit handle instead. That
   * path can call this same function without duplicating the bootstrap
   * sequence.
   */
  async function bootstrapSession(
    sessionId: string,
    bundleConfig: Bundle,
    token: string,
    transport: StreamableHTTPServerTransport,
    mcpServer: Server
  ): Promise<void> {
    const strategy = (bundler.getConfig().loading_strategy ?? "progressive") as LoadingStrategy;

    // Create session with full bundle catalog so middleware can inspect it
    const session = bundler.createSession(sessionId, bundleConfig.bundleId, token, bundleConfig.upstreams);
    session.setLoadingStrategy(strategy);

    // Wire session list-changed events to MCP server notifications so the
    // downstream agent receives notifications/tools/list_changed etc.
    session.on(SESSION_EVENTS.NOTIFY_TOOLS_CHANGED, () => {
      mcpServer.sendToolListChanged().catch((err: Error) =>
        logger.warn({ sessionId, err: err.message }, "Failed to send tools/list_changed notification")
      );
    });
    session.on(SESSION_EVENTS.NOTIFY_RESOURCES_CHANGED, () => {
      mcpServer.sendResourceListChanged().catch((err: Error) =>
        logger.warn({ sessionId, err: err.message }, "Failed to send resources/list_changed notification")
      );
    });
    session.on(SESSION_EVENTS.NOTIFY_PROMPTS_CHANGED, () => {
      mcpServer.sendPromptListChanged().catch((err: Error) =>
        logger.warn({ sessionId, err: err.message }, "Failed to send prompts/list_changed notification")
      );
    });

    // Install LLM tool router if the bundle carries router config with at least one signal enabled.
    // Must be called before addSession so the session is passed directly.
    if (bundleConfig.router) {
      bundler.installRouterMiddleware(session, bundleConfig.router);
    }

    // Store session before attaching upstreams so MCP handlers can reach it
    bundler.addSession(sessionId, session);

    const setContextEnabled = bundleConfig.router?.set_context?.enabled ?? false;

    if (setContextEnabled) {
      // set_context is enabled: the LLM ranks namespaces before any upstream connects.
      // Nothing loads here — the router middleware drives attachment after the agent
      // calls bundler__set_context with a task description.
      logger.debug({ sessionId, strategy }, "set_context enabled: upstream selection deferred to LLM router");
    } else if (strategy === LoadingStrategy.EAGER) {
      // Block until all upstreams are connected, then emit once so the client
      // receives a complete tool list on its very first tools/list request.
      await bundler.attachUpstreamsAsync(session, bundleConfig.upstreams);
      session.emitListChanged();
      logger.debug({ sessionId, strategy }, "All upstreams attached (eager)");
    } else {
      // PROGRESSIVE: respond immediately; client receives list_changed
      // notifications as each upstream comes online.
      bundler.attachUpstreamsAsync(session, bundleConfig.upstreams)
        .then(() => logger.debug({ sessionId, strategy }, "All upstreams attached (progressive)"))
        .catch((err: Error) => logger.error({ sessionId, err: err.message }, "Upstream attach error"));
    }

    // Start idle monitoring for automatic cleanup
    session.startIdleMonitoring();

    // Handle session shutdown (triggered by idle timeout or manual close)
    session.on(SESSION_EVENTS.SHUTDOWN, () => {
      logger.info({ sessionId }, "Session shutdown event, cleaning up");
      cleanupSession(sessionId);
    });

    // Store transport metadata (mcpServer kept for runtime middleware access)
    transportMeta.set(sessionId, {
      transport,
      mcpServer,
      bundleId: bundleConfig.bundleId,
      createdAt: Date.now()
    });

    logger.info({ sessionId, bundleId: bundleConfig.bundleId, strategy }, "MCP session initialized");
  }

  /**
   * Handle POST /mcp - Main message handler
   */
  router.post("/mcp", mcpLimiter, async (req: Request, res: Response) => {
    const ua = req.headers["user-agent"];
    const ip = req.ip || req.socket.remoteAddress;
    const sessionId = sessionIdentity.resolve(req);
    const config = bundler.getConfig();

    // Validate Accept header
    if (!validateAcceptHeader(req)) {
      res.status(406).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Not Acceptable: Client must accept both application/json and text/event-stream"
        },
        id: null
      });
      return;
    }

    // Check if this is an initialize request (new session)
    const isInitialize = req.body?.method === "initialize";

    if (sessionId && transportMeta.has(sessionId)) {
      // Existing session - use existing transport
      const meta = transportMeta.get(sessionId)!;
      bundler.getSession(sessionId)?.recordActivity();

      try {
        await meta.transport.handleRequest(req, res, req.body);
      } catch (error: any) {
        logger.error({ error: error.message, sessionId }, "Error handling MCP request");
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error" },
            id: req.body?.id || null
          });
        }
      }
    } else if (!sessionId && isInitialize) {
      // New session - authenticate and create transport

      // Reject new sessions while draining (see BundlerServer.shutdown) -
      // existing sessions above are unaffected and keep running until they
      // end naturally or the drain timeout force-closes them.
      if (bundler.isDraining()) {
        res.status(503).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Server is shutting down, please retry against another instance" },
          id: req.body?.id || null
        });
        return;
      }

      // Reject connections during startup grace period
      if (Date.now() - bundler.getServerStartTime() < startupGracePeriodMs) {
        logger.warn({ userAgent: ua, ip }, "Rejecting connection during startup grace period");
        res.status(503).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Server is starting up, please retry in a moment" },
          id: req.body?.id || null
        });
        return;
      }

      // Check session capacity
      if (bundler.getSessionCount() >= config.concurrency.max_concurrent) {
        logger.warn({ currentSessions: bundler.getSessionCount(), max: config.concurrency.max_concurrent },
          "Max sessions reached, rejecting new connection");
        res.status(503).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Too many active sessions" },
          id: req.body?.id || null
        });
        return;
      }

      // Extract and validate bearer token
      const token = extractBearerToken(req);
      if (!token) {
        logger.warn({ userAgent: ua, ip }, "Missing or invalid Authorization header");
        res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Unauthorized: Bearer token required" },
          id: req.body?.id || null
        });
        return;
      }

      // Resolve bundle from token
      let bundleConfig;
      try {
        bundleConfig = await bundler.getBundleResolver().resolveBundle(token);
        logger.info({
          bundleId: bundleConfig.bundleId,
          bundleName: bundleConfig.name,
          upstreamCount: bundleConfig.upstreams.length,
          userAgent: ua,
          ip
        }, "Successfully resolved bundle from token");
      } catch (error: any) {
        const status = error.status || 401;
        const message = error.message || "Bundle resolution failed";

        logger.error({
          error: message,
          status,
          userAgent: ua,
          ip
        }, "Failed to resolve bundle from token");

        res.status(status).json({
          jsonrpc: "2.0",
          error: { code: -32000, message },
          id: req.body?.id || null
        });
        return;
      }

      // Create StreamableHTTP transport with session initialization callback
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionIdentity.issue(),
        enableJsonResponse: true,
        onsessioninitialized: async (sessionId) => {
          await bootstrapSession(sessionId, bundleConfig, token, transport, mcpServer);
        },
        onsessionclosed: (sessionId) => {
          logger.info({ sessionId }, "MCP session closed via transport");
          cleanupSession(sessionId);
        }
      });

      // Handle transport close
      transport.onclose = () => {
        if (transport.sessionId) {
          logger.info({ sessionId: transport.sessionId }, "Transport closed");
          cleanupSession(transport.sessionId);
        }
      };

      // Handle transport errors (AbortError during disconnect is expected)
      transport.onerror = (error: Error) => {
        if (error.name === "AbortError") {
          logger.debug({ sessionId: transport.sessionId }, "Transport aborted (expected during disconnect)");
        } else {
          logger.error({ sessionId: transport.sessionId, error: error.message }, "Transport error");
        }
      };

      // Create a dedicated MCP Server for this session and connect it to the transport.
      // The SDK enforces a 1:1 Server-to-Transport relationship.
      const mcpServer = bundler.createMCPServer();
      await mcpServer.connect(transport);

      // Handle the initialize request - this triggers onsessioninitialized
      await transport.handleRequest(req, res, req.body);

      if (transport.sessionId) {
        logger.info({
          sessionId: transport.sessionId,
          bundleId: bundleConfig.bundleId,
          userAgent: ua,
          ip
        }, "New MCP session established");
      }
    } else if (sessionId && !transportMeta.has(sessionId)) {
      // Session ID provided but session doesn't exist (expired or invalid)
      logger.warn({ sessionId, userAgent: ua, ip }, "Request with unknown session ID");
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session not found or expired" },
        id: req.body?.id || null
      });
    } else {
      // No session ID and not an initialize request
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid request: session ID required or must be initialize request" },
        id: req.body?.id || null
      });
    }
  });

  /**
   * Handle GET /mcp - SSE stream for server-initiated messages
   */
  router.get("/mcp", mcpLimiter, async (req: Request, res: Response) => {
    const sessionId = sessionIdentity.resolve(req) as string;
    const meta = transportMeta.get(sessionId);

    if (!meta) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid session" },
        id: null
      });
      return;
    }

    bundler.getSession(sessionId)?.recordActivity();

    try {
      await meta.transport.handleRequest(req, res);
    } catch (error: any) {
      logger.error({ error: error.message, sessionId }, "Error handling MCP GET request");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal error" },
          id: null
        });
      }
    }
  });

  /**
   * Handle DELETE /mcp - Session termination
   */
  router.delete("/mcp", mcpLimiter, async (req: Request, res: Response) => {
    const sessionId = sessionIdentity.resolve(req) as string;
    const meta = transportMeta.get(sessionId);

    if (!meta) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid session" },
        id: null
      });
      return;
    }

    logger.info({ sessionId }, "Client requested session termination");

    try {
      await meta.transport.handleRequest(req, res);
    } catch (error: any) {
      logger.warn({ error: error.message, sessionId }, "Error handling MCP DELETE request");
      if (!res.headersSent) {
        res.status(200).end();
      }
    }
  });

  /**
   * Switch the loading strategy on an active session at runtime.
   * Accepts: { "strategy": "eager" | "progressive" }
   * Only affects future upstream-attach calls (e.g. from middleware).
   */
  router.put("/mcp/strategy", mcpLimiter, async (req: Request, res: Response) => {
    const sessionId = sessionIdentity.resolve(req) as string;
    if (!sessionId || !transportMeta.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const { strategy } = req.body ?? {};
    if (strategy !== LoadingStrategy.EAGER && strategy !== LoadingStrategy.PROGRESSIVE) {
      res.status(400).json({ error: `strategy must be "${LoadingStrategy.EAGER}" or "${LoadingStrategy.PROGRESSIVE}"` });
      return;
    }

    const updated = bundler.setSessionLoadingStrategy(sessionId, strategy as LoadingStrategy);
    if (!updated) {
      res.status(404).json({ error: "Session not found in bundler" });
      return;
    }

    logger.info({ sessionId, strategy }, "Loading strategy updated at runtime");
    res.json({ sessionId, strategy });
  });

  /**
   * Add a named middleware to an active session.
   * Body: { "name": "<middleware-name>" }
   * Currently only "passthrough" is available as a built-in;
   * future names will be registered by the bundler configuration.
   */
  router.post("/mcp/middleware", mcpLimiter, async (req: Request, res: Response) => {
    const sessionId = sessionIdentity.resolve(req) as string;
    if (!sessionId || !transportMeta.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const { name } = req.body ?? {};
    if (typeof name !== "string" || !name) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const session = bundler.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found in bundler" });
      return;
    }

    if (session.getMiddlewareNames().includes(name)) {
      res.status(409).json({ error: `Middleware "${name}" is already installed on this session` });
      return;
    }

    const instance = bundler.instantiateMiddleware(name, sessionId);
    if (!instance) {
      res.status(400).json({
        error: `Unknown middleware "${name}"`,
        registered: bundler.getRegisteredMiddlewareNames(),
      });
      return;
    }

    bundler.addMiddlewareToSession(sessionId, instance);
    session.emitListChanged();

    logger.info({ sessionId, middleware: name }, "Middleware installed via API");
    res.json({ sessionId, middleware: name, status: "installed" });
  });

  /**
   * Remove a middleware from an active session by name.
   */
  router.delete("/mcp/middleware/:name", mcpLimiter, async (req: Request, res: Response) => {
    const sessionId = sessionIdentity.resolve(req) as string;
    if (!sessionId || !transportMeta.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const name = req.params.name as string;
    const removed = bundler.removeMiddlewareFromSession(sessionId, name);
    if (!removed) {
      res.status(404).json({ error: `Middleware "${name}" not found on this session` });
      return;
    }

    logger.info({ sessionId, middleware: name }, "Middleware removed via API");
    res.json({ sessionId, middleware: name, status: "removed" });
  });

  /**
   * Kubernetes readiness probe - deliberately separate from /status. Liveness
   * must stay healthy while draining (the process is fine, just intentionally
   * not accepting new work), but readiness should fail so the Service/Ingress
   * stops routing NEW connections here as early as possible - a defense-in-
   * depth signal alongside Kubernetes' own automatic exclusion of Terminating
   * pods from Endpoints.
   */
  router.get("/ready", async (_req: Request, res: Response) => {
    if (bundler.isDraining()) {
      res.status(503).json({ ready: false, draining: true });
      return;
    }
    res.status(200).json({ ready: true });
  });

  /**
   * Get session stats for monitoring
   */
  router.get("/status", mcpLimiter, async (_req: Request, res: Response) => {
    const config = bundler.getConfig();

    const metrics = {
      sessions: {
        active: bundler.getSessionCount(),
        max: config.concurrency.max_concurrent,
        details: bundler.getAllSessions().map((session, index) => ({
          id: index,
          idleTimeMs: session.getTimeSinceLastActivity(),
          upstreams: session.getAllUpstreams().length
        }))
      },
      selfServiceEnabled: process.env.SELF_SERVICE_ENABLED === "true",
      wildcardTokenEnabled: process.env.RESOLVER_WILDCARD_ALLOW === "true",
    };
    res.json(metrics);
  });

  /**
   * Prometheus metrics endpoint for scraping
   */
  router.get("/metrics", async (_req: Request, res: Response) => {
    res.set("Content-Type", register.contentType);
    res.end(await getPrometheusMetrics());
  });

  return router;
}
