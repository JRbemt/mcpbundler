// Polyfill EventSource for Node so the SDK client can connect to downstream SSE.
import { EventSource } from "eventsource"
globalThis.EventSource = EventSource;

import express, { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import logger from "../utils/logger.js";
import { Session } from "./session.js";
import { BundlerConfig, UpstreamConfig } from "./config/schemas.js";
import { Upstream, UpstreamPool } from "./upstream.js";
import { ResolverService } from "./collection-resolver.js";
import { createBundlerRoutes } from "./routes/bundler-routes.js";

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
  private collection_resolver: ResolverService;
  private app: express.Application;

  constructor(
    config: BundlerConfig,
    collection_resolver: ResolverService,
  ) {
    this.config = config;
    this.serverStartTime = Date.now();
    this.upstreamPool = new UpstreamPool();
    this.sessions = {};
    this.collection_resolver = collection_resolver;

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

    // Mount bundler routes
    app.use(createBundlerRoutes(this));

    // Error handler
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
  public attachUpstreams(session: Session, configs: UpstreamConfig[]): void {
    for (const config of configs) {
      const upstream: Upstream = config.stateless
        ? this.upstreamPool.getOrCreate(config)
        : new Upstream(config);
      session.attach(upstream);
    }
  }

  /**
   * Start the bundler server
   */
  async start(): Promise<{
    shutdown: () => Promise<void>;
  }> {
    logger.info({
      name: this.config.name,
      version: this.config.version,
      host: this.config.host,
      port: this.config.port,
      maxSessions: this.config.concurrency.max_sessions,
    }, "Starting MCP Bundler server");

    // Start HTTP server
    this.httpServer = await new Promise((resolve, reject) => {
      const server = this.app.listen(this.config.port, this.config.host, () => {
        const addr = server.address();
        if (typeof addr === "string") {
          logger.info(`server listening ${addr}`);
        } else if (addr && typeof addr === "object") {
          logger.info(`server listening http://${addr.address}:${addr.port}`);
        } else {
          logger.info({ msg: "server listening (address unknown)" });
        }
        resolve(server);
      });
      server.on("error", (err) => {
        logger.error({ error: err }, "HTTP server error");
      });
    });

    // Return server control object
    return {
      shutdown: this.shutdown.bind(this)
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info({ msg: "shutting down server" });

    // Close all active sessions
    for (const [sid, session] of Object.entries(this.sessions)) {
      try {
        await session.close();
      } catch (e) {
        logger.warn({ msg: "error during session shutdown", sessionId: sid, e });
      }
    }

    // Close HTTP server
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          logger.info({ msg: "http server closed" });
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getApp(): express.Application {
    return this.app;
  }

  getMcpServer(): Server {
    return this.mcpServer;
  }

  getHttpServer(): any {
    return this.httpServer;
  }

  getSessions(): Record<string, Session> {
    return this.sessions;
  }

  getAuthClient(): ResolverService {
    return this.collection_resolver;
  }

  getUpstreamPool(): UpstreamPool {
    return this.upstreamPool;
  }

  getConfig(): BundlerConfig {
    return this.config;
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

