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
 * - GET  /metrics - Public monitoring endpoint
 *
 * Rate limiting: 10 connections per IP per 15 minutes. Session limit enforced
 * by max_sessions config. Automatic idle timeout cleanup.
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Session, SESSION_EVENTS } from "../session.js";
import logger from "../../utils/logger.js";
import type { BundlerServer } from "../bundler.js";

/**
 * Create bundler routes
 *
 * @param bundler The bundler server instance
 * @returns Express router with SSE and message endpoints
 */
export function createBundlerRoutes(bundler: BundlerServer): Router {
  const router = Router();
  const startupGracePeriodMs = 1000;

  const sseLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
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

    // Create SSE transport and session
    const transport = new SSEServerTransport("/messages", res);

    logger.info({ sessionId: transport.sessionId, userAgent: ua, ip }, "starting new SSE connection");
    const session = new Session(
      transport,
      bundleConfig.bundleId,
    );

    // Attach resolved upstreams from bundle
    bundler.attachUpstreams(session, bundleConfig.upstreams);

    sessions[transport.sessionId] = session;
    await session.connect();

    // Start idle monitoring for automatic cleanup
    session.startIdleMonitoring();

    // Handle session shutdown (triggered by idle timeout or manual close)
    session.on(SESSION_EVENTS.SHUTDOWN, () => {
      logger.info({ sessionId: transport.sessionId }, "Session shutdown, removing from sessions map");
      delete sessions[transport.sessionId];
    });

    await bundler.getMcpServer().connect(transport);
    logger.info({ sessionId: transport.sessionId }, "new SSE connection established");

    // When client disconnects, close the session (shutdown handler above will clean up)
    res.on("close", async () => {
      logger.info({ sessionId: transport.sessionId }, "client disconnected, closing session");
      await session.close();
    });
  });

  router.post("/messages", async (req: Request, res: Response) => {
    const sessionId: string = req.query.sessionId as string;
    const sessions = bundler.getSessions();
    const session = sessions[sessionId];

    if (!session) {
      logger.warn({
        requestedSessionId: sessionId,
        availableSessions: Object.keys(sessions)
      }, "No session found for /messages");
      res.status(400).send("No transport found for sessionId");
      return;
    }

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
    await session.transport.handlePostMessage(req, res);
  });

  // Public monitoring endpoint for observability
  router.get("/metrics", sseLimiter, async (_req: Request, res: Response) => {
    const sessions = bundler.getSessions();
    const config = bundler.getConfig();

    const metrics = {
      sessions: {
        active: Object.keys(sessions).length,
        max: config.concurrency.max_concurrent,
        details: Object.values(sessions).map((session, index) => ({
          id: index,
          idleTimeMs: session.getTimeSinceLastActivity(),
          upstreams: (session as any).upstreams.length
        }))
      }
    };
    res.json(metrics);
  });

  return router;
}
