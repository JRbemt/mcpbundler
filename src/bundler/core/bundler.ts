/**
 * Bundler - Main MCP multiplexing server
 *
 * Acts as a proxy and multiplexer for multiple upstream MCP servers, presenting them
 * as a unified interface to clients. Handles session management, request routing,
 * permission enforcement, and namespace collision resolution.
 *
 * Key responsibilities:
 * - Accept client connections via StreamableHTTP (/mcp) or SSE (/sse) with token-based authentication
 * - Route MCP requests to appropriate upstream servers
 * - Aggregate responses from multiple upstreams
 * - Enforce per-MCP permissions and handle namespace collisions
 * - Monitor session activity and implement idle timeouts
 */

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

import { BundlerConfig, MCPConfig } from "./schemas.js";
import { NamespaceResolver } from "./session/namespace-resolver.js";
import { PermissionManager } from "./session/permission-manager.js";
import { ResolverService } from "./bundle-resolver.js";
import { createSseRoutes } from "../routes/bundler-sse-routes.js";
import { createMcpRoutes } from "../routes/bundler-mcp-routes.js";
import { Session } from "./session/session.js";
import { AuditBundlerAction, withAudit } from "../../shared/utils/audit-log.js";
import logger from "../../shared/utils/logger.js";
import { UpstreamConnectorFactory } from "./upstream/upstream-connector-factory.js";
import { UpstreamConnectionPool } from "./upstream/upstream-connector-pool.js";

/**
 * MCP Bundler Server Class
 */
export class BundlerServer {
  private serverStartTime: number;
  private config: BundlerConfig;
  private sessions: Record<string, Session>;
  private httpServer: any;
  private bundleResolver: ResolverService;
  private app: express.Application;

  // Shared services across sessions
  private namespaceResolver: NamespaceResolver;
  private permissionManager: PermissionManager;
  private connectorFactory: UpstreamConnectorFactory;
  private connectionPool: UpstreamConnectionPool;

  constructor(
    config: BundlerConfig,
    bundleResolver: ResolverService,
  ) {
    this.config = config;
    this.serverStartTime = Date.now();
    this.sessions = {};
    this.bundleResolver = bundleResolver;

    this.namespaceResolver = new NamespaceResolver();
    this.permissionManager = new PermissionManager();
    this.connectorFactory = new UpstreamConnectorFactory();
    this.connectionPool = new UpstreamConnectionPool();

    this.app = this.createExpressApp();
  }

  /**
   * Creates a new MCP Server instance with registered handlers.
   * Called once per session because the MCP SDK enforces a 1:1
   * relationship between a Server and its Transport.
   */
  createMCPServer(): Server {
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
      return await withAudit({
        fn: () => session.listTools(req.params),
        action: AuditBundlerAction.MCP_TOOLS_LIST,
        sessionId: session.id
      });
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
      return await withAudit({
        fn: () => session.callTool(req.params),
        action: AuditBundlerAction.MCP_TOOL_CALL,
        sessionId: session.id
      });
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
      return await withAudit({
        fn: () => session.listResources(req.params),
        action: AuditBundlerAction.MCP_RESOURCES_LIST,
        sessionId: session.id
      });
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
      return await withAudit({
        fn: () => session.listResourceTemplates(req.params),
        action: AuditBundlerAction.MCP_RESOURCES_LIST,
        sessionId: session.id
      });
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
      return await withAudit({
        fn: () => session.readResource(req.params),
        action: AuditBundlerAction.MCP_RESOURCE_READ,
        sessionId: session.id
      });
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
      return await withAudit({
        fn: () => session.listPrompts(req.params),
        action: AuditBundlerAction.MCP_PROMPTS_LIST,
        sessionId: session.id
      });
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
      return await withAudit({
        fn: () => session.getPrompt(req.params),
        action: AuditBundlerAction.MCP_PROMPT_GET,
        sessionId: session.id
      });
    });

    return server;
  }

  /**
   * Sets up Express app with all routes and middleware
   */
  private createExpressApp(): express.Application {
    const app = express();

    // JSON body parsing for StreamableHTTP transport
    app.use(express.json());

    // Mount StreamableHTTP MCP routes (/mcp endpoint)
    app.use(createMcpRoutes(this));

    // Mount legacy SSE bundler routes (/sse, /messages endpoints)
    app.use(createSseRoutes(this));

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
   * Create a new session with the new architecture
   */
  public createSession(sessionId: string, bundleId: string): Session {
    return Session.create(
      sessionId,
      bundleId,
      this.namespaceResolver,
      this.permissionManager,
      this.connectorFactory,
      this.connectionPool
    );
  }

  /**
   * Attach upstreams to a session (async - uses new attachUpstream API)
   */
  public async attachUpstreamsAsync(session: Session, configs: MCPConfig[]): Promise<void> {
    for (const config of configs) {
      try {
        await session.attachUpstream(config);
      } catch (error: any) {
        logger.error({
          sessionId: session.id,
          namespace: config.namespace,
          error: error?.message || error
        }, "Failed to attach upstream");
      }
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
      maxSessions: this.config.concurrency.max_concurrent,
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

  getHttpServer(): any {
    return this.httpServer;
  }

  getSessions(): Record<string, Session> {
    return this.sessions;
  }

  getBundleResolver(): ResolverService {
    return this.bundleResolver;
  }

  getConnectionPool(): UpstreamConnectionPool {
    return this.connectionPool;
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
