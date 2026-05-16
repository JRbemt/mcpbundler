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
import { ResolverService } from "./resolver/service.js";
import { createSseRoutes } from "../routes/bundler-sse-routes.js";
import { createMcpRoutes } from "../routes/bundler-mcp-routes.js";
import { Session } from "./session/session.js";
import { AuditBundlerAction, withAudit } from "../../shared/utils/audit-log.js";
import logger from "../../shared/utils/logger.js";
import { UpstreamConnectorFactory } from "./upstream/upstream-connector-factory.js";
import { UpstreamConnectionPool } from "./upstream/upstream-connector-pool.js";
import { LoadingStrategy } from "./loading/loading-strategy.js";
import { BundlerMiddleware } from "./middleware/bundler-middleware.js";
import { PassthroughMiddleware } from "./middleware/passthrough-middleware.js";
import { BundlerSystemToolsMiddleware } from "./middleware/bundler-system-tools-middleware.js";

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
   * Create a new session with default middleware pre-installed.
   * Stores the full bundle catalog on the session so middleware can inspect
   * available (but not yet attached) upstreams.
   */
  public createSession(sessionId: string, bundleId: string, availableUpstreams: MCPConfig[] = []): Session {
    const session = Session.create(
      sessionId,
      bundleId,
      this.namespaceResolver,
      this.permissionManager,
      this.connectorFactory,
      this.connectionPool
    );
    session.setAvailableUpstreams(availableUpstreams);

    // Install default middleware: passthrough identity + system tools registry
    session.addMiddleware(new PassthroughMiddleware());
    session.addMiddleware(new BundlerSystemToolsMiddleware());

    return session;
  }

  /**
   * Attach upstreams to a session concurrently.
   * All upstreams begin their connection handshake in parallel; failures are
   * isolated per-upstream and do not block others.
   */
  public async attachUpstreamsAsync(session: Session, configs: MCPConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      configs.map((config) => session.attachUpstream(config))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        logger.error({
          sessionId: session.id,
          namespace: configs[i].namespace,
          error: result.reason?.message ?? result.reason,
        }, "Failed to attach upstream");
      }
    }
  }

  /**
   * Change the loading strategy on an active session.
   * Takes effect immediately for any subsequent upstream-attach calls
   * (e.g. triggered by middleware dynamic composition).
   */
  public setSessionLoadingStrategy(sessionId: string, strategy: LoadingStrategy): boolean {
    const session = this.sessions[sessionId];
    if (!session) return false;
    session.setLoadingStrategy(strategy);
    return true;
  }

  /**
   * Add a middleware to an active session at runtime.
   */
  public addMiddlewareToSession(sessionId: string, middleware: BundlerMiddleware): boolean {
    const session = this.sessions[sessionId];
    if (!session) return false;
    session.addMiddleware(middleware);
    return true;
  }

  /**
   * Remove a middleware from an active session by name.
   */
  public removeMiddlewareFromSession(sessionId: string, middlewareName: string): boolean {
    const session = this.sessions[sessionId];
    if (!session) return false;
    return session.removeMiddleware(middlewareName);
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
