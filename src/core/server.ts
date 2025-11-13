// Polyfill EventSource for Node so the SDK client can connect to downstream SSE.
import { EventSource } from "eventsource"
globalThis.EventSource = EventSource;

import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import logger from '../utils/logger.js';
import { Session } from "./session.js";
import { BundlerConfig, UpstreamConfig } from "../config/schemas.js";
import { Upstream, UpstreamPool } from "./upstream.js";
import { AuthService } from "../services/auth/collection-auth.js";
import { MeteringService } from "../services/telemetry/MeteringService.js";
import { createCollectionRoutes } from "../api/routes/collections.js";
import { createMcpRoutes } from "../api/routes/mcps.js";
import { createOAuthRoutes } from "../api/routes/oauth.js";
import { createTokenRoutes } from "../api/routes/tokens.js";
import { PrismaClient } from "@prisma/client";

/**
 * MCP Bundler Server Class
 * 
 * Encapsulates all server state and logic in a clean class-based architecture.
 */
export class BundlerServer {
  private serverStartTime: number;
  private upstreamPool: UpstreamPool;
  private mcpServer: Server;
  private config: BundlerConfig;
  private sessions: Record<string, Session>;
  private httpServer: any;
  private authClient: AuthService;
  private app: express.Application;
  private meteringService: MeteringService | null = null;

  private prisma: PrismaClient;

  constructor(
    config: BundlerConfig,
    authService: AuthService,
    prisma: PrismaClient
  ) {
    this.config = config;
    this.serverStartTime = Date.now();
    this.upstreamPool = new UpstreamPool();
    this.sessions = {};
    this.authClient = authService;

    this.prisma = prisma;

    // Initialize metering service if configured
    if (config.metering?.enabled && config.metering?.service_token) {
      this.meteringService = new MeteringService({
        backendUrl: config.backend?.base_url || 'http://localhost:8000',
        serviceToken: config.metering.service_token,
        flushIntervalMs: config.metering.flush_interval_ms,
        batchSize: config.metering.batch_size,
        enabled: config.metering.enabled,
      });
    } else {
      logger.info('MeteringService not initialized - disabled or missing service token');
    }

    // Create and configure
    this.mcpServer = this.createMCPServer();
    this.app = this.createExpressApp();
  }

  /**
   * Creates and configures the MCP Server instance
   */
  private createMCPServer(): Server {
    const server = new Server(
      {
        name: this.config.name,
        version: this.config.version,
      },
      {
        capabilities: {
          tools: {
            listChanged: true
          },
          resources: {
            listChanged: true
          },
          prompts: {
            listChanged: true
          },
        },
      },
    );

    /*
    * LIST_TOOLS
    */
    server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        logger.warn(`SessionId: ${sessionId} not found for tools/list`);
        throw new Error("SessionId missing in request context");
      }

      const session = this.sessions[sessionId];
      return await session.listTools(req.params);
    });

    /*
     * CALL_TOOL
     */
    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        logger.warn(`SessionId: ${sessionId} not found for tools/call`);
        throw new Error("SessionId missing in request context");
      }

      const session = this.sessions[sessionId];
      return await session.callTool(req.params);
    });

    /*
     * LIST_RESOURCES
     */
    server.setRequestHandler(ListResourcesRequestSchema, async (req, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        logger.warn(`SessionId: ${sessionId} not found for resources/list`);
        throw new Error("SessionId missing in request context");
      }
      const session = this.sessions[sessionId];
      return await session.listResources(req.params);
    });

    /*
     * LIST_RESOURCES_TEMPLATES
     */
    server.setRequestHandler(ListResourceTemplatesRequestSchema, async (req, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        logger.warn(`SessionId: ${sessionId} not found for resources/list`);
        throw new Error("SessionId missing in request context");
      }
      const session = this.sessions[sessionId];
      return await session.listResourceTemplates(req.params);
    });

    /*
     * READ_RESOURCE
     */
    server.setRequestHandler(ReadResourceRequestSchema, async (req, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        logger.warn(`SessionId: ${sessionId} not found for resources/read`);
        throw new Error("SessionId missing in request context");
      }
      const session = this.sessions[sessionId];
      return await session.readResource(req.params);
    });

    /*
     * LIST_PROMPTS
     */
    server.setRequestHandler(ListPromptsRequestSchema, async (req, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        logger.warn(`SessionId: ${sessionId} not found for prompts/list`);
        throw new Error("SessionId missing in request context");
      }
      const session = this.sessions[sessionId];
      return await session.listPrompts(req.params);
    });

    /*
     * GET_PROMPT
     */
    server.setRequestHandler(GetPromptRequestSchema, async (req, extra) => {
      const sessionId = extra.sessionId;
      if (!sessionId) {
        logger.warn(`SessionId: ${sessionId} not found for prompts/get`);
        throw new Error("SessionId missing in request context");
      }
      const session = this.sessions[sessionId];
      return await session.getPrompt(req.params);
    });

    return server;
  }

  /**
   * Sets up Express app with all routes and middleware
   */
  private createExpressApp(): express.Application {
    const app = express();


    // JSON middleware
    app.use(express.json());

    // Collection management API routes
    app.use('/api/collections', createCollectionRoutes(this.prisma));

    // Token management API routes
    app.use('/api/collections', createTokenRoutes(this.prisma));
    app.use('/api/tokens', createTokenRoutes(this.prisma));

    // MCP management API routes
    app.use('/api/mcps', createMcpRoutes(this.prisma));

    // OAuth authorization routes
    const publicUrl = process.env.PUBLIC_URL || `http://${this.config.host}:${this.config.port}`;
    app.use('/api', createOAuthRoutes(publicUrl, this.prisma));

    // Rate limiting for SSE endpoint
    const sseLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 connections per IP per window
      message: { error: "Too many connection attempts, please try again later" },
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.get("/sse", sseLimiter, async (req: Request, res: Response) => {
      const ua = req.headers["user-agent"];
      const ip = req.ip || req.socket.remoteAddress;

      // 1. Require Authorization header with collection token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn({ userAgent: ua, ip }, "Missing or invalid Authorization header");
        res.status(401).json({ error: "Bearer token required" });
        return;
      }

      const token = authHeader.substring(7);

      // 2. Startup blocking
      // if ((Date.now() - this.serverStartTime) < this.config.concurrency.startup_block_ms) {
      //   logger.warn({ userAgent: ua, ip }, "Rejected SSE connection (too soon after startup)");
      //   res.status(503).end();
      //   return;
      // }

      // 3. Max sessions check
      if (Object.keys(this.sessions).length >= this.config.concurrency.max_sessions) {
        logger.warn("Max sessions reached, rejecting new connection");
        res.status(503).json({ error: "Too many active sessions" });
        return;
      }

      // 4. Handle existing session reconnection
      if (req.query.sessionId) {
        if ((req.query.sessionId as string) in this.sessions) {
          logger.info({ sessionId: req.query.sessionId, userAgent: ua, ip }, `existing SSE connection reestablished`);
          res.status(200);
        } else {
          res.status(400).json({
            body: "unknown session"
          });
          logger.warn({ unknownSessionId: req.query.sessionId, userAgent: ua, ip }, "trying to get unknown session")
        }
        return;
      }

      // 5. Resolve collection from token
      let collectionConfig;
      try {
        collectionConfig = await this.authClient.resolveCollection(token);

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

      // 6. Create SSE transport and session
      const transport = new SSEServerTransport('/messages', res);

      logger.info({ sessionId: transport.sessionId, userAgent: ua, ip }, `starting new SSE connection`);
      const session = new Session(
        transport,
        this.meteringService,
        collectionConfig.collection_id,
        collectionConfig.user_id
      );

      // Record session_created event
      if (this.meteringService && collectionConfig.collection_id && collectionConfig.user_id) {
        this.meteringService.recordEvent({
          event_type: 'session_created',
          timestamp: new Date().toISOString(),
          user_id: collectionConfig.user_id,
          collection_id: collectionConfig.collection_id,
          session_id: transport.sessionId,
        });
      }

      // Attach resolved upstreams from collection
      this.attachUpstreams(session, collectionConfig.upstreams);

      // Wire up session notifications to MCP server
      this.setupSessionNotifications(session, transport);

      this.sessions[transport.sessionId] = session;
      await session.connect();

      // Start idle monitoring for automatic cleanup
      session.startIdleMonitoring();

      // Handle idle timeout event
      session.on('idle_timeout', () => {
        logger.info({ sessionId: transport.sessionId }, 'Removing idle session');
        delete this.sessions[transport.sessionId];
      });

      await this.mcpServer.connect(transport);
      logger.info({ sessionId: transport.sessionId }, `new SSE connection established`);

      res.on("close", () => {
        delete this.sessions[transport.sessionId];
      });
    });

    app.post("/messages", async (req: Request, res: Response) => {
      const sessionId: string = req.query.sessionId as string;
      const session = this.sessions[sessionId];

      const chunks: any[] = [];
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        logger.debug({ sessionId, method: payload?.method, id: payload?.id, params: payload.params }, "received /messages payload");
      });

      if (!session) {
        logger.warn({ sessionId }, "No session found for /messages");
        res.status(400).send('No transport found for sessionId');
        return;
      };
      await session.transport.handlePostMessage(req, res);
    });

    // Monitoring endpoint for observability
    app.get("/metrics", async (req: Request, res: Response) => {
      const metrics = {
        sessions: {
          active: Object.keys(this.sessions).length,
          max: this.config.concurrency.max_sessions,
          details: Object.entries(this.sessions).map(([id, session]) => ({
            id,
            idleTimeMs: session.getTimeSinceLastActivity(),
            upstreams: session['upstreams'].length
          }))
        },
        upstreams: Array.from(this.upstreamPool['managers'].entries()).map(([ns, upstream]) => ({
          namespace: ns,
          connected: upstream.isConnected(),
        }))
      };
      res.json(metrics);
    });

    app.use((err: any, req: Request, res: Response, _next: any) => {
      logger.error(
        { err, url: req.url, method: req.method, body: req.body },
        "Unhandled Express error"
      );
      res.status(500).json({ error: "Internal server error" });
    });

    return app;
  }

  /**
   * Attach upstreams to a session
   */
  private attachUpstreams(session: Session, configs: UpstreamConfig[]): void {
    for (const config of configs) {
      const upstream: Upstream = config.stateless
        ? this.upstreamPool.getOrCreate(config)
        : new Upstream(config);
      session.attach(upstream);
    }
  }

  /**
   * Wire up session notifications to MCP server
   * Forwards dynamic list change notifications from session to MCP client
   */
  private setupSessionNotifications(session: Session, transport: SSEServerTransport): void {
    // Forward tools list changed notifications
    session.on('notify_tools_changed', async (notification) => {
      logger.debug({ sessionId: session.getId() }, 'Forwarding tools_list_changed to client');
      try {
        await this.mcpServer.notification({
          method: notification.method,
          params: notification.params
        });
      } catch (error) {
        logger.warn({ sessionId: session.getId(), error }, 'Failed to send tools notification');
      }
    });

    // Forward resources list changed notifications
    session.on('notify_resources_changed', async (notification) => {
      logger.debug({ sessionId: session.getId() }, 'Forwarding resources_list_changed to client');
      try {
        await this.mcpServer.notification({
          method: notification.method,
          params: notification.params
        });
      } catch (error) {
        logger.warn({ sessionId: session.getId(), error }, 'Failed to send resources notification');
      }
    });

    // Forward prompts list changed notifications
    session.on('notify_prompts_changed', async (notification) => {
      logger.debug({ sessionId: session.getId() }, 'Forwarding prompts_list_changed to client');
      try {
        await this.mcpServer.notification({
          method: notification.method,
          params: notification.params
        });
      } catch (error) {
        logger.warn({ sessionId: session.getId(), error }, 'Failed to send prompts notification');
      }
    });
  }

  /**
   * Start the bundler server
   */
  async start(): Promise<{
    httpServer: any;
    mcpServer: Server;
    shutdown: () => Promise<void>;
  }> {
    logger.info({
      name: this.config.name,
      version: this.config.version,
      host: this.config.host,
      port: this.config.port,
      maxSessions: this.config.concurrency.max_sessions,
      instanceId: this.config.manager?.instance_id,
      managerEndpoint: this.config.manager?.manager_endpoint
    }, "Starting MCP Bundler server");

    // Start HTTP server
    this.httpServer = await new Promise((resolve, reject) => {
      const server = this.app.listen(this.config.port, this.config.host, () => {
        const addr = server.address();
        if (typeof addr === 'string') {
          logger.info({ address: addr }, "server listening");
        } else if (addr && typeof addr === 'object') {
          logger.info({ host: addr.address, port: addr.port }, `server listening http://${addr.address}:${addr.port}`);
        } else {
          logger.info({ msg: 'server listening (address unknown)' });
        }
        resolve(server);
      });
      server.on('error', (err) => {
        logger.error({ error: err }, "HTTP server error");
      });
    });

    // Return server control object
    return {
      httpServer: this.httpServer,
      mcpServer: this.mcpServer,
      shutdown: this.shutdown.bind(this)
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info({ msg: 'shutting down server' });

    // Close all active sessions
    for (const [sid, session] of Object.entries(this.sessions)) {
      try {
        await session.close();
      } catch (e) {
        logger.warn({ msg: 'error during session shutdown', sessionId: sid, e });
      }
    }

    // Shutdown metering service (flush remaining events)
    if (this.meteringService) {
      try {
        await this.meteringService.shutdown();
      } catch (e) {
        logger.warn({ msg: 'error during metering service shutdown', e });
      }
    }

    // Close HTTP server
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          logger.info({ msg: 'http server closed' });
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server statistics
   */
  getStats(): {
    activeSessions: number;
    uptime: number;
    config: BundlerConfig;
  } {
    return {
      activeSessions: Object.keys(this.sessions).length,
      uptime: Date.now() - this.serverStartTime,
      config: this.config
    };
  }
}

