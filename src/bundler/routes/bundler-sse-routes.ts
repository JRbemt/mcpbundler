/**
 * Bundler Routes - Client-facing SSE endpoints for MCP multiplexing
 *
 * Provides SSE connection endpoints for clients to connect to the bundler.
 * Authenticates using bearer tokens, resolves bundle configurations, and
 * creates per-client sessions.
 *
 * Endpoints:
 * - GET  /sse - Establish SSE connection (bearer token auth, rate limited)
 * - POST /messages - Send MCP messages to session
 *
 * Rate limiting: 10 connections per IP per 15 minutes. Session limit enforced
 * by max_sessions config. Automatic idle timeout cleanup.
 *
 * @deprecated Use StreamableHTTP /mcp endpoint instead
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { SESSION_EVENTS } from "../core/session/session.js";
import type { BundlerServer } from "../core/bundler.js";
import logger from "../../shared/utils/logger.js";

/**
 * Transport metadata for SSE session tracking
 */
interface SseTransportMeta {
  transport: SSEServerTransport;
  bundleId: string;
  createdAt: number;
}

/**
 * Create bundler routes
 *
 * @param bundler The bundler server instance
 * @returns Express router with SSE and message endpoints
 *
 * @deprecated Use StreamableHTTP /mcp endpoint instead
 */
export function createSseRoutes(bundler: BundlerServer): Router {
  const router = Router();
  const startupGracePeriodMs = 1000;

  // Store transport metadata by session ID
  const transportMeta = new Map<string, SseTransportMeta>();

  const sseLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minutes
    max: 10, // 10 connections per IP per window
    message: { error: "Too many connection attempts, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get("/sse", sseLimiter, async (req: Request, res: Response) => {
    const ua = req.headers["user-agent"];
    const ip = req.ip || req.socket.remoteAddress;
    const sessions = bundler.getSessions();
    const config = bundler.getConfig();
    logger.info({
      headers: req.headers,
    })

    const authHeader = req.headers.authorization;
    const token = authHeader?.substring(7) || "";

    // Reject connections during startup grace period (first 1 second)
    const serverStartTime = (bundler as any).serverStartTime;
    if (serverStartTime && Date.now() - serverStartTime < startupGracePeriodMs) {
      logger.warn({ userAgent: ua, ip }, "Rejecting connection during startup grace period");
      res.status(503).json({ error: "Server is starting up, please retry in a moment" });
      return;
    }

    if (Object.keys(sessions).length >= config.concurrency.max_concurrent) {
      logger.warn("Max sessions reached, rejecting new connection");
      res.status(503).json({ error: "Too many active sessions" });
      return;
    }

    // Handle existing session reconnection
    if (req.query.sessionId) {
      if ((req.query.sessionId as string) in sessions) {
        logger.info({ sessionId: req.query.sessionId, userAgent: ua, ip }, "existing SSE connection reestablished");
        res.status(200);
      } else {
        res.status(400).json({
          body: "No session found"
        });
        logger.warn({ unknownSessionId: req.query.sessionId, userAgent: ua, ip }, "trying to get unknown session");
      }
      return;
    }

    // Resolve bundle from token
    let bundleConfig;
    try {
      bundleConfig = await bundler.getBundleResolver().resolveBundle(token);
      logger.debug(bundleConfig, "resolved bundle")

      logger.info({
        bundleId: bundleConfig.bundleId,
        bundleName: bundleConfig.name,
        upstreamCount: bundleConfig.upstreams.length,
        userAgent: ua,
        ip
      }, "Successfully resolved bundle from token");
    } catch (error: any) {
      const status = error.status || 500;
      const message = error.message || "Bundle resolution failed";

      logger.error({
        error: message,
        status,
        userAgent: ua,
        ip
      }, "Failed to resolve bundle from token");

      res.status(status).json({ error: message });
      return;
    }

    // Create SSE transport
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;

    logger.info({ sessionId, userAgent: ua, ip }, "starting new SSE connection");

    // Create session using new architecture
    const session = bundler.createSession(sessionId, bundleConfig.bundleId);

    // Attach resolved upstreams from bundle (async)
    bundler.attachUpstreamsAsync(session, bundleConfig.upstreams).then(() => {
      logger.debug({ sessionId }, "Session connected to upstreams");
    }).catch((err) => {
      logger.error({ sessionId, error: err.message }, "Failed to connect session to upstreams");
    });

    // Store session and transport
    sessions[sessionId] = session;
    transportMeta.set(sessionId, {
      transport,
      bundleId: bundleConfig.bundleId,
      createdAt: Date.now()
    });

    // Start idle monitoring for automatic cleanup
    session.startIdleMonitoring();

    // Handle session shutdown (triggered by idle timeout or manual close)
    session.on(SESSION_EVENTS.SHUTDOWN, () => {
      logger.info({ sessionId }, "Session shutdown, removing from sessions map");
      delete sessions[sessionId];
      transportMeta.delete(sessionId);
    });

    await bundler.getMcpServer().connect(transport);
    logger.info({ sessionId }, "new SSE connection established");

    // When client disconnects, close the session (shutdown handler above will clean up)
    res.on("close", async () => {
      logger.info({ sessionId }, "client disconnected, closing session");
      await session.close();
    });
  });

  router.post("/messages", async (req: Request, res: Response) => {
    const sessionId: string = req.query.sessionId as string;
    const sessions = bundler.getSessions();
    const session = sessions[sessionId];
    const meta = transportMeta.get(sessionId);

    if (!session || !meta) {
      logger.warn({
        requestedSessionId: sessionId,
        availableSessions: Object.keys(sessions)
      }, "No session found for /messages");
      res.status(400).send("No transport found for sessionId");
      return;
    }

    // Touch session to update activity
    session.touch();

    const chunks: any[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      logger.debug({
        method: payload?.method,
        id: payload?.id,
        params: payload.params
      }, "received /messages payload");
    });
    await meta.transport.handlePostMessage(req, res);
  });

  // Public monitoring endpoint for observability

  return router;
}
