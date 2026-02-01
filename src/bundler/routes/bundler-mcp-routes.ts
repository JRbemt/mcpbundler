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
import { randomUUID } from "crypto";
import { BundlerServer } from "../core/bundler.js";
import { SESSION_EVENTS } from "../app/core/Session.js";
import logger from "../../shared/utils/logger.js";
/**
 * Transport metadata for session tracking
 */
interface TransportMeta {
  transport: StreamableHTTPServerTransport;
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
    const sessions = bundler.getSessions();
    const session = sessions[sessionId];

    // Remove from maps FIRST to prevent re-entry
    delete sessions[sessionId];
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
   * Handle POST /mcp - Main message handler
   */
  router.post("/mcp", mcpLimiter, async (req: Request, res: Response) => {
    const ua = req.headers["user-agent"];
    const ip = req.ip || req.socket.remoteAddress;
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const config = bundler.getConfig();
    const sessions = bundler.getSessions();

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
      const session = sessions[sessionId];

      if (session) {
        session.touch();
      }

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

      // Reject connections during startup grace period
      const serverStartTime = (bundler as any).serverStartTime;
      if (serverStartTime && Date.now() - serverStartTime < startupGracePeriodMs) {
        logger.warn({ userAgent: ua, ip }, "Rejecting connection during startup grace period");
        res.status(503).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Server is starting up, please retry in a moment" },
          id: req.body?.id || null
        });
        return;
      }

      // Check session capacity
      const currentSessionCount = Object.keys(sessions).length;
      if (currentSessionCount >= config.concurrency.max_concurrent) {
        logger.warn({ currentSessions: currentSessionCount, max: config.concurrency.max_concurrent },
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
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: async (sessionId) => {
          // Session ID is now available - create the Session object using new architecture
          const session = bundler.createSession(sessionId, bundleConfig.bundleId);

          // Attach resolved upstreams from bundle (async)
          bundler.attachUpstreamsAsync(session, bundleConfig.upstreams).then(() => {
            logger.debug({ sessionId }, "Session connected to upstreams");
          }).catch((err) => {
            logger.error({ sessionId, error: err.message }, "Failed to connect session to upstreams");
          });

          // Start idle monitoring for automatic cleanup
          session.startIdleMonitoring();

          // Handle session shutdown (triggered by idle timeout or manual close)
          session.on(SESSION_EVENTS.SHUTDOWN, () => {
            logger.info({ sessionId }, "Session shutdown event, cleaning up");
            cleanupSession(sessionId);
          });

          // Store session in bundler's sessions map (used by MCP handlers)
          sessions[sessionId] = session;

          // Store transport metadata
          transportMeta.set(sessionId, {
            transport,
            bundleId: bundleConfig.bundleId,
            createdAt: Date.now()
          });

          logger.info({ sessionId, bundleId: bundleConfig.bundleId }, "MCP session initialized");
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

      // Connect MCP server to transport BEFORE handling request
      // This ensures handlers are wired up when initialize response is processed
      await bundler.getMcpServer().connect(transport);

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
    const sessionId = req.headers["mcp-session-id"] as string;
    const meta = transportMeta.get(sessionId);
    const sessions = bundler.getSessions();

    if (!meta) {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Invalid session" },
        id: null
      });
      return;
    }

    const session = sessions[sessionId];
    if (session) {
      session.touch();
    }

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
    const sessionId = req.headers["mcp-session-id"] as string;
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
      logger.error({ error: error.message, sessionId }, "Error handling MCP DELETE request");
    }

    // Clean up session
    await cleanupSession(sessionId);
  });

  /**
   * Get session stats for monitoring
   */
  router.get("/metrics", mcpLimiter, async (_req: Request, res: Response) => {
    const sessions = bundler.getSessions();
    const config = bundler.getConfig();

    const metrics = {
      sessions: {
        active: Object.keys(sessions).length,
        max: config.concurrency.max_concurrent,
        details: Object.values(sessions).map((session, index) => ({
          id: index,
          idleTimeMs: session.getTimeSinceLastActivity(),
          upstreams: session.getAllUpstreams().length
        }))
      }
    };
    res.json(metrics);
  });

  return router;
}
