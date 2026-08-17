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
import { createOAuthRoutes } from "../routes/bundler-oauth-routes.js";
import { Session } from "./session/session.js";
import { AuditBundlerAction, withAudit } from "../../shared/utils/audit-log.js";
import logger from "../../shared/utils/logger.js";
import { UpstreamConnectorFactory } from "./upstream/upstream-connector-factory.js";
import { UpstreamConnectionPool } from "./upstream/upstream-connector-pool.js";
import { InMemorySessionStateStore, SessionStateStore } from "./session/session-state-store.js";
import { LoadingStrategy } from "./session/loading/loading-strategy.js";
import { attachUpstreamsConcurrently } from "./session/loading/attach-stage-upstreams.js";
import { BundlerStage } from "./session/stage.js";
import { BundlerMiddleware } from "./middleware/middleware.js";
import { BundlerSystemToolsMiddleware } from "./middleware/builtin-tools.js";
import { DiscoveryClient } from "./discovery/discovery-client.js";
import { registerDiscoveryTools, DISCOVERY_RATE_LIMIT_RULES } from "./middleware/discovery-tools.js";
import { AnonymousRateLimitMiddleware } from "./middleware/anonymous-rate-limit.js";
import { requestDeviceCode, pollDeviceToken } from "./discovery/device-flow-client.js";
import { DeploymentBootstrapClient } from "./discovery/deployment-bootstrap-client.js";
import { registerConnectionTools, CONNECTION_RATE_LIMIT_RULES } from "./middleware/connection-tools.js";
import { LLMRouterTool, getLLM, registerLLM, getRegisteredLLMNames } from "./middleware/llm-router/router-tool.js";
import { LLMToolRouterMiddleware } from "./middleware/llm-router/router-tool-middleware.js";
import { OpenAICompatClient } from "./middleware/llm-router/llm/openai-compat.js";
import { LLMNamespaceSelector } from "./middleware/llm-router/llm/namespace-selector.js";
import { BundleRouterConfig, LLMProviderConfig } from "./schemas.js";
import { LedgerClient } from "./billing/ledger-client.js";
import { TokenSpendCheckMiddleware } from "./middleware/billing/token-spend-check-middleware.js";

/**
 * MCP Bundler Server Class
 */
export class BundlerServer {
  private serverStartTime: number;
  private config: BundlerConfig;
  private sessions: Map<string, Session> = new Map();
  private httpServer: any;
  private bundleResolver: ResolverService;
  private app: express.Application;

  // Set at the start of shutdown() and never cleared - routes check this to
  // reject NEW sessions while letting already-open ones keep running until
  // they end naturally or the drain timeout forces them closed. This is what
  // lets a rolling Kubernetes deploy phase out an old pod's connections
  // instead of cutting every active session the instant SIGTERM arrives.
  private draining = false;

  // Shared services across sessions
  private namespaceResolver: NamespaceResolver;
  private permissionManager: PermissionManager;
  private connectorFactory: UpstreamConnectorFactory;
  private connectionPool: UpstreamConnectionPool;
  private stateStore: SessionStateStore;
  private discoveryBackendUrl: string;
  private deploymentBootstrapClient: DeploymentBootstrapClient;

  // Middleware factory registry for runtime instantiation via POST /mcp/middleware
  private middlewareFactories: Map<string, (sessionId: string) => BundlerMiddleware> = new Map();

  constructor(
    config: BundlerConfig,
    bundleResolver: ResolverService,
  ) {
    this.config = config;
    this.serverStartTime = Date.now();
    this.bundleResolver = bundleResolver;

    this.namespaceResolver = new NamespaceResolver();
    this.permissionManager = new PermissionManager();
    this.connectorFactory = new UpstreamConnectorFactory();
    this.connectionPool = new UpstreamConnectionPool();
    this.stateStore = new InMemorySessionStateStore();
    this.discoveryBackendUrl = process.env.BACKEND_URL?.trimEnd().replace(/\/$/, "") ?? "";
    this.deploymentBootstrapClient = new DeploymentBootstrapClient(this.discoveryBackendUrl);

    this.middlewareFactories.set("llm-tool-router", (_sid) =>
      new LLMToolRouterMiddleware({ llm: getLLM("allpass"), store: this.stateStore })
    );

    for (const provider of config.llm_providers ?? []) {
      this.registerLLMProvider(provider);
    }

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

      const session = this.sessions.get(sessionId)!
      return await withAudit({
        fn: () => session.listTools(req.params),
        action: AuditBundlerAction.MCP_TOOLS_LIST,
        sessionId: session.id,
        accessToken: session.accessToken
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

      const session = this.sessions.get(sessionId)!
      let mcpNamespace: string | undefined;
      let toolName = req.params.name;
      try {
        const parsed = this.namespaceResolver.extractNamespaceFromName(req.params.name);
        mcpNamespace = parsed.namespace;
        toolName = parsed.address;
      } catch (err) {
        // Telemetry annotation must never block the actual tool call - fall
        // back to the raw name if it doesn't parse as namespace__name (e.g.
        // a middleware-owned tool outside the normal convention).
        logger.debug({ err, name: req.params.name }, "Could not split tool name into namespace/address for telemetry");
      }
      return await withAudit({
        fn: () => session.callTool(req.params),
        action: AuditBundlerAction.MCP_TOOL_CALL,
        sessionId: session.id,
        accessToken: session.accessToken,
        toolName,
        mcpNamespace,
        bytesOf: (result) => JSON.stringify(result).length,
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
      const session = this.sessions.get(sessionId)!
      return await withAudit({
        fn: () => session.listResources(req.params),
        action: AuditBundlerAction.MCP_RESOURCES_LIST,
        sessionId: session.id,
        accessToken: session.accessToken
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
      const session = this.sessions.get(sessionId)!
      return await withAudit({
        fn: () => session.listResourceTemplates(req.params),
        action: AuditBundlerAction.MCP_RESOURCE_TEMPLATES_LIST,
        sessionId: session.id,
        accessToken: session.accessToken
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
      const session = this.sessions.get(sessionId)!
      return await withAudit({
        fn: () => session.readResource(req.params),
        action: AuditBundlerAction.MCP_RESOURCE_READ,
        sessionId: session.id,
        accessToken: session.accessToken
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
      const session = this.sessions.get(sessionId)!
      return await withAudit({
        fn: () => session.listPrompts(req.params),
        action: AuditBundlerAction.MCP_PROMPTS_LIST,
        sessionId: session.id,
        accessToken: session.accessToken
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
      const session = this.sessions.get(sessionId)!
      return await withAudit({
        fn: () => session.getPrompt(req.params),
        action: AuditBundlerAction.MCP_PROMPT_GET,
        sessionId: session.id,
        accessToken: session.accessToken
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

    // Mount OAuth 2.1 discovery routes (RFC 9728 Protected Resource Metadata).
    // Gated behind BUNDLER_NATIVE_OAUTH_ENABLED alongside the bundle-scoped
    // /mcp/:bundleId routes in bundler-mcp-routes.ts - this document only
    // has a purpose once those routes are live, and the backend audience
    // check those routes depend on is what makes enabling both safe.
    if (process.env.BUNDLER_NATIVE_OAUTH_ENABLED === "true") {
      app.use(createOAuthRoutes());
    }

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
  public createSession(sessionId: string, bundleId: string, accessToken: string, availableUpstreams: MCPConfig[] = []): Session {
    const session = Session.create(
      sessionId,
      bundleId,
      accessToken,
      this.namespaceResolver,
      this.permissionManager,
      this.connectorFactory,
      this.connectionPool,
      this.stateStore
    );
    session.setAvailableUpstreams(availableUpstreams);

    // Install default middleware: system tools registry for bundler meta-tools
    session.addMiddleware(new BundlerSystemToolsMiddleware());

    return session;
  }

  /**
   * Create a session with no bundle and no upstreams - the entry point for
   * an agent that hasn't authenticated yet. Only bundler-native discovery
   * tools are available at first, but the session carries the same real
   * shared services createSession gives every other session, so a later
   * stage transition (a subsequent phase) can attach real upstreams to
   * this exact session without needing to reconstruct or rehydrate it.
   */
  public createAnonymousSession(sessionId: string): Session {
    const session = Session.create(
      sessionId,
      "anonymous",
      "",
      this.namespaceResolver,
      this.permissionManager,
      this.connectorFactory,
      this.connectionPool,
      this.stateStore
    );

    const systemTools = new BundlerSystemToolsMiddleware();
    const discoveryClient = new DiscoveryClient(this.discoveryBackendUrl);
    registerDiscoveryTools(systemTools, discoveryClient);

    // Registered ahead of systemTools so its handleOwnToolCall can veto a
    // call before systemTools ever sees it - see anonymous-rate-limit.ts
    // for why this has to be handleOwnToolCall rather than onBeforeToolCall.
    const rateLimiter = new AnonymousRateLimitMiddleware(
      [...DISCOVERY_RATE_LIMIT_RULES, ...CONNECTION_RATE_LIMIT_RULES],
      this.stateStore,
    );
    session.addMiddleware(rateLimiter);

    // verification_uri currently points at Keycloak's own generic
    // device-approval page, not a bundle-aware consent screen - a human
    // approving a code there has no way to know which agent or bundle
    // they are authorizing. Do not register these tools for production
    // traffic until a bundle-aware consent page replaces that page and
    // this flag is deliberately turned on.
    if (process.env.BUNDLER_DEVICE_FLOW_ENABLED === "true") {
      registerConnectionTools(systemTools, {
        discoveryClient,
        requestDeviceCode,
        pollDeviceToken,
        bootstrapClient: this.deploymentBootstrapClient,
        stateStore: this.stateStore,
        onConnected: (sid, bundleId, bundleAccessToken) =>
          this.transitionSessionToBundle(sid, bundleId, bundleAccessToken),
      });
    }
    session.addMiddleware(systemTools);

    // Record this as the session's current stage so a future transitionTo
    // call correctly unloads these anonymous-stage middlewares first,
    // instead of leaving them installed alongside whatever the new stage
    // adds - see Session.setCurrentStage. The connection tools register
    // onto this same systemTools instance rather than adding a separate
    // middleware, so the stage's middleware list is unchanged by the flag.
    session.setCurrentStage({
      name: "anonymous",
      middlewares: [rateLimiter, systemTools],
      upstreams: [],
      loadingStrategy: LoadingStrategy.EAGER,
    });

    return session;
  }

  /**
   * Completes the anonymous-to-bundle handoff once bundler__check_connection_status
   * has a real bundle access token: resolves it into a full bundle
   * configuration through the same resolver every authenticated session
   * already uses, then transitions the live session onto the bundle's
   * stage in place.
   *
   * The stage built here deliberately omits LLM router middleware even when
   * the resolved bundle carries router config - installRouterMiddleware
   * requires a session not yet registered in this.sessions (see its own
   * doc comment), which no longer holds once a session has been running on
   * the anonymous stage. Wiring router config into a mid-session transition
   * is left for a later phase.
   *
   * The session's accessToken is set to the real bundle token as soon as
   * the stage transition is confirmed, before the token spend check is
   * installed - every MCP handler's `withAudit` telemetry call and the
   * spend check's reconcile calls both read `session.accessToken` from that
   * point forward, so neither short-circuits on an empty token for
   * subsequent bundle activity.
   *
   * Known constraint: for a bundle stage using `LoadingStrategy.EAGER`,
   * `transitionSessionToStage` below awaits full upstream attachment before
   * returning, so this call blocks on every upstream connecting - for a
   * large or slow bundle that can exceed a client's tool-call timeout.
   * Forcing `LoadingStrategy.PROGRESSIVE` for all device-flow transitions is
   * a reasonable follow-up if this becomes a real problem, since the client
   * is already connected and can receive per-upstream list_changed
   * notifications as they land.
   */
  private async transitionSessionToBundle(sessionId: string, bundleId: string, bundleAccessToken: string): Promise<void> {
    const bundleConfig = await this.bundleResolver.resolveBundle(bundleAccessToken);
    const strategy = (this.config.loading_strategy ?? "progressive") as LoadingStrategy;

    const bundleStage: BundlerStage = {
      name: `bundle:${bundleConfig.bundleId}`,
      middlewares: [],
      upstreams: bundleConfig.upstreams,
      loadingStrategy: strategy,
    };

    const transitioned = await this.transitionSessionToStage(sessionId, bundleStage);
    if (!transitioned) {
      logger.warn({ sessionId, bundleId }, "Session not found for bundle stage transition");
      return;
    }

    // The real bundle token is only known once the transition target is
    // confirmed - set it before installing the spend check, since the
    // check's reconcile calls read ctx.accessToken (which reads
    // session.accessToken) on every tool call from this point forward.
    const session = this.sessions.get(sessionId);
    if (session) {
      session.setAccessToken(bundleAccessToken);
      this.installSpendCheckMiddleware(session);
    }

    logger.info({ sessionId, bundleId: bundleConfig.bundleId }, "Session transitioned from anonymous to bundle stage");
  }

  /**
   * Attach upstreams to a session concurrently. Thin delegate to the shared
   * attachUpstreamsConcurrently helper (session/loading/attach-stage-upstreams.ts),
   * retained specifically for the legacy SSE bootstrap path's caller
   * (bundler-sse-routes.ts). The StreamableHTTP bootstrap path and
   * Session.transitionTo bypass this method and call attachStageUpstreams
   * directly instead - all three paths still end up sharing the same
   * underlying "attach many, isolate per-upstream failures" implementation
   * in attachUpstreamsConcurrently, just not through this entry point.
   */
  public async attachUpstreamsAsync(session: Session, configs: MCPConfig[]): Promise<void> {
    return attachUpstreamsConcurrently(session, configs);
  }

  /**
   * Change the loading strategy on an active session.
   * Takes effect immediately for any subsequent upstream-attach calls
   * (e.g. triggered by middleware dynamic composition).
   */
  public setSessionLoadingStrategy(sessionId: string, strategy: LoadingStrategy): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.setLoadingStrategy(strategy);
    return true;
  }

  // Session registry

  public getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  public addSession(id: string, session: Session): void {
    this.sessions.set(id, session);
  }

  public removeSession(id: string): void {
    this.sessions.delete(id);
  }

  public getSessionCount(): number {
    return this.sessions.size;
  }

  public getAllSessions(): Session[] {
    return [...this.sessions.values()];
  }

  public getServerStartTime(): number {
    return this.serverStartTime;
  }

  public isDraining(): boolean {
    return this.draining;
  }

  /**
   * Add a middleware to an active session at runtime.
   */
  public addMiddlewareToSession(sessionId: string, middleware: BundlerMiddleware): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.addMiddleware(middleware);
    return true;
  }

  /**
   * Remove a middleware from an active session by name.
   */
  public async removeMiddlewareFromSession(sessionId: string, middlewareName: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.removeMiddleware(middlewareName);
  }

  /**
   * Move an active session to a new stage in place. Thin session-registry
   * wrapper around Session.transitionTo, mirroring
   * addMiddlewareToSession/removeMiddlewareFromSession's sessionId-based
   * entry point rather than requiring callers to hold a raw Session.
   */
  public async transitionSessionToStage(sessionId: string, stage: BundlerStage): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    await session.transitionTo(stage);
    return true;
  }

  /**
   * Register an LLM implementation under a name for use by the tool router.
   */
  public registerLLM(modelName: string, impl: LLMRouterTool): void {
    registerLLM(modelName, impl);
  }

  /**
   * Instantiate an LLM client from a config block and register it in the global registry.
   */
  public registerLLMProvider(config: LLMProviderConfig): void {
    const client = new OpenAICompatClient({
      type: "openai-compatible",
      model: config.model,
      endpoint: config.endpoint,
      apiKey: config.api_key,
      temperature: config.temperature,
      maxTokens: config.max_tokens,
      timeoutMs: config.timeout_ms,
    });
    registerLLM(config.name, new LLMNamespaceSelector(client));
    logger.info({ name: config.name, model: config.model, endpoint: config.endpoint }, "LLM provider registered");
  }

  /**
   * Retrieve a registered LLM by name. Falls back to "allpass" if not found.
   */
  public getLLM(modelName: string): LLMRouterTool {
    return getLLM(modelName);
  }

  public getRegisteredLLMNames(): string[] {
    return getRegisteredLLMNames();
  }

  /**
   * Register a factory function for a named middleware type.
   * Called by POST /mcp/middleware to instantiate middleware on demand.
   */
  public registerMiddlewareFactory(name: string, factory: (sessionId: string) => BundlerMiddleware): void {
    this.middlewareFactories.set(name, factory);
  }

  /**
   * Instantiate a middleware by registered name. Returns null if unknown.
   */
  public instantiateMiddleware(name: string, sessionId: string): BundlerMiddleware | null {
    const factory = this.middlewareFactories.get(name);
    if (!factory) return null;
    return factory(sessionId);
  }

  public getRegisteredMiddlewareNames(): string[] {
    return [...this.middlewareFactories.keys()];
  }

  /**
   * Install the LLM tool router middleware on a session from a resolved router config.
   * Takes the session directly - called during session init before the session is
   * stored in the registry, so a lookup by ID would always miss.
   */
  public installRouterMiddleware(session: Session, router: BundleRouterConfig): void {
    if (!router) return;
    const rollingEnabled = router.rolling_window?.enabled ?? false;
    const setContextEnabled = router.set_context?.enabled ?? false;
    if (!rollingEnabled && !setContextEnabled) return;

    let llm: LLMRouterTool;
    if (router.llm) {
      const client = new OpenAICompatClient({
        type: "openai-compatible",
        model: router.llm.model,
        endpoint: router.llm.endpoint,
        apiKey: router.llm.api_key,
        temperature: router.llm.temperature,
        maxTokens: router.llm.max_tokens,
        timeoutMs: router.llm.timeout_ms,
      });
      llm = new LLMNamespaceSelector(client);
    } else {
      llm = getLLM(router.model ?? "allpass");
    }
    session.addMiddleware(new LLMToolRouterMiddleware({
      llm,
      rollingWindow: router.rolling_window
        ? {
          enabled: router.rolling_window.enabled,
          maxActiveUpstreams: router.rolling_window.max_active_upstreams,
          windowSize: router.rolling_window.window_size,
          reRankEveryNCalls: router.rolling_window.re_rank_every_n_calls,
        }
        : undefined,
      setContext: router.set_context
        ? {
          enabled: router.set_context.enabled,
          maxActiveUpstreams: router.set_context.max_active_upstreams,
        }
        : undefined,
      store: this.stateStore,
    }));
    logger.info({ sessionId: session.id, model: router.model, rollingEnabled, setContextEnabled }, "LLM tool router installed");
  }

  /**
   * Install the token spend-check middleware on a session (never the
   * anonymous discovery session - see BundlerServer.createSession vs. a
   * future anonymous-session path, which has no upstreams and nothing to
   * bill).
   *
   * Gated behind BUNDLER_TOKEN_BILLING_ENABLED, the same pattern
   * BUNDLER_DEVICE_FLOW_ENABLED and BUNDLER_NATIVE_OAUTH_ENABLED use
   * elsewhere in this file: nothing in this deployment yet grants a new
   * user any tokens automatically (grant_subscription_tokens exists on the
   * backend but nothing calls it on subscription creation, and the Stripe/
   * x402 top-up rails require operator-side payment configuration too), so
   * every account starts and stays at a balance of 0. Installing this
   * unconditionally would make every tool call on every bundle fail with
   * "Insufficient token balance" the moment a deployment enables billing at
   * all - defaulting to off lets an operator turn it on once a real grant
   * path exists for their deployment, rather than shipping a silent outage.
   *
   * Also no-ops when BACKEND_URL is not set: self-hosted/YAML-config
   * deployments (the Node-only bundler DB mode - see the dual-backend
   * architecture note) have no FastAPI backend to reconcile against, so
   * there is no ledger to check. Reads both env vars directly rather than
   * threading them through the constructor, matching the existing pattern
   * in shared/utils/audit-log.ts.
   */
  public installSpendCheckMiddleware(session: Session): void {
    if (process.env.BUNDLER_TOKEN_BILLING_ENABLED !== "true") {
      logger.debug(
        { sessionId: session.id },
        "BUNDLER_TOKEN_BILLING_ENABLED not set; skipping token spend check"
      );
      return;
    }
    const backendUrl = process.env.BACKEND_URL?.trimEnd().replace(/\/$/, "") ?? "";
    if (!backendUrl) {
      logger.debug(
        { sessionId: session.id },
        "BACKEND_URL not set; skipping token spend check (self-hosted/YAML mode)"
      );
      return;
    }
    session.addMiddleware(new TokenSpendCheckMiddleware({
      ledgerClient: new LedgerClient(backendUrl),
      store: this.stateStore,
    }));
    logger.info({ sessionId: session.id }, "Token spend check middleware installed");
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
   * Graceful shutdown - phases out active connections instead of cutting them.
   *
   * Sets `draining` so routes stop accepting new sessions immediately, then
   * waits for currently-open sessions to end on their own (client disconnect,
   * idle timeout) rather than force-closing them. `SHUTDOWN_DRAIN_TIMEOUT_MS`
   * is a backstop: if sessions are still open when it elapses, they're force-
   * closed and shutdown proceeds anyway. Keep this value comfortably below
   * the Kubernetes Pod's `terminationGracePeriodSeconds` (see
   * infra/k8s/base/bundler/deployment.yaml) so the process can exit cleanly
   * and log what it force-closed, instead of being SIGKILLed mid-drain with
   * no chance to record why.
   */
  async shutdown(): Promise<void> {
    logger.info({ msg: "shutting down server - draining active sessions" });
    this.draining = true;

    const httpClosed = new Promise<void>((resolve) => {
      if (this.httpServer) {
        // Stops accepting NEW connections; resolves once every currently-open
        // connection (including long-lived SSE streams) has ended on its own.
        this.httpServer.close(() => {
          logger.info({ msg: "http server closed" });
          resolve();
        });
      } else {
        resolve();
      }
    });

    const drainTimeoutMs = parseInt(process.env.SHUTDOWN_DRAIN_TIMEOUT_MS || "", 10) || 4 * 60 * 60 * 1000;
    const timedOut = await Promise.race([
      httpClosed.then(() => false),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), drainTimeoutMs)),
    ]);

    if (timedOut) {
      logger.warn(
        { remainingSessions: this.sessions.size, drainTimeoutMs },
        "Drain timeout elapsed with sessions still open - force-closing remaining sessions"
      );
      for (const [sid, session] of this.sessions) {
        try {
          await session.close();
        } catch (e) {
          logger.warn({ msg: "error during forced session shutdown", sessionId: sid, e });
        }
      }
    }
  }

  getApp(): express.Application {
    return this.app;
  }

  getHttpServer(): any {
    return this.httpServer;
  }

  getBundleResolver(): ResolverService {
    return this.bundleResolver;
  }

  getDeploymentBootstrapClient(): DeploymentBootstrapClient {
    return this.deploymentBootstrapClient;
  }

  /**
   * The backend base URL used to resolve anonymous discovery requests
   * (bundler__search_bundles / bundler__get_bundle). Empty in self-hosted/
   * YAML-only deployments that never set BACKEND_URL - callers use this to
   * decide whether the anonymous discovery session is offered at all.
   */
  getDiscoveryBackendUrl(): string {
    return this.discoveryBackendUrl;
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
      activeSessions: this.sessions.size,
      uptime: Date.now() - this.serverStartTime,
      config: this.config
    };
  }
}
