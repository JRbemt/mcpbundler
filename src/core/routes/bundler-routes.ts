import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Session } from "../session.js";
import logger from "../../utils/logger.js";
import type { BundlerServer } from "../bundler.js";

export function createBundlerRoutes(bundler: BundlerServer): Router {
  const router = Router();

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

    const authHeader = req.headers.authorization;
    const token = authHeader?.substring(7) || "";

    if (Object.keys(sessions).length >= config.concurrency.max_sessions) {
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
          body: "unknown session"
        });
        logger.warn({ unknownSessionId: req.query.sessionId, userAgent: ua, ip }, "trying to get unknown session");
      }
      return;
    }

    // Resolve collection from token
    let collectionConfig;
    try {
      collectionConfig = await bundler.getAuthClient().resolveCollection(token);
      logger.debug(collectionConfig, "resolved collection")

      logger.info({
        collectionId: collectionConfig.collection_id,
        collectionName: collectionConfig.name,
        upstreamCount: collectionConfig.upstreams.length,
        userAgent: ua,
        ip
      }, "Successfully resolved collection from token");

    } catch (error: any) {
      const status = error.status || 500;
      const message = error.message || "Collection resolution failed";

      logger.error({
        error: message,
        status,
        userAgent: ua,
        ip
      }, "Failed to resolve collection from token");

      res.status(status).json({ error: message });
      return;
    }

    // Create SSE transport and session
    const transport = new SSEServerTransport("/messages", res);

    logger.info({ sessionId: transport.sessionId, userAgent: ua, ip }, "starting new SSE connection");
    const session = new Session(
      transport,
      collectionConfig.collection_id,
      collectionConfig.user_id
    );

    // Attach resolved upstreams from collection
    bundler.attachUpstreams(session, collectionConfig.upstreams);

    sessions[transport.sessionId] = session;
    await session.connect();

    // Start idle monitoring for automatic cleanup
    session.startIdleMonitoring();

    // Handle idle timeout event
    session.on("idle_timeout", () => {
      logger.info({ sessionId: transport.sessionId }, "Removing idle session");
      delete sessions[transport.sessionId];
    });

    await bundler.getMcpServer().connect(transport);
    logger.info({ sessionId: transport.sessionId }, "new SSE connection established");

    res.on("close", () => {
      delete sessions[transport.sessionId];
    });
  });

  router.post("/messages", async (req: Request, res: Response) => {
    const sessionId: string = req.query.sessionId as string;
    const sessions = bundler.getSessions();
    const session = sessions[sessionId];

    const chunks: any[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      logger.debug({ sessionId, method: payload?.method, id: payload?.id, params: payload.params }, "received /messages payload");
    });

    if (!session) {
      logger.warn({ sessionId }, "No session found for /messages");
      res.status(400).send("No transport found for sessionId");
      return;
    }
    await session.transport.handlePostMessage(req, res);
  });

  // Public monitoring endpoint for observability
  router.get("/metrics", sseLimiter, async (_req: Request, res: Response) => {
    const sessions = bundler.getSessions();
    const config = bundler.getConfig();
    const upstreamPool = bundler.getUpstreamPool();

    const metrics = {
      sessions: {
        active: Object.keys(sessions).length,
        max: config.concurrency.max_sessions,
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
