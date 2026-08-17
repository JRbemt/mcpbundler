/**
 * Session Domain Entity (Aggregate Root)
 *
 * Rich domain model that owns its behavior and dependencies.
 * Session controls upstream creation, filtering, namespacing, and connection pooling.
 * Aggregates MCP operations across multiple upstream connectors.
 *
 * Features:
 * - Resumption token tracking per upstream/operation for long-running requests
 * - Audit logging for all MCP operations
 * - Capability checking before upstream calls
 * - Configurable upstream request timeout
 * - Notification forwarding for list_changed events
 */
import { EventEmitter } from "events";
import { createSessionEstablished, createUpstreamConnected, createUpstreamDisconnected } from "../events.js";
import { UpstreamEventCoordinator } from "../upstream/upstream-event-coordinator.js";
import { IUpstreamConnector, UPSTREAM_EVENTS } from "../upstream/upstream.js";
import { MCPConfig } from "../schemas.js";
import { INamespaceService } from "./namespace-resolver.js";
import { IPermissionService } from "./permission-manager.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import {
    CallToolRequest,
    CallToolResult,
    ListToolsRequest,
    ListToolsResult,
    ListResourcesRequest,
    ListResourcesResult,
    ReadResourceRequest,
    ReadResourceResult,
    ListResourceTemplatesRequest,
    ListResourceTemplatesResult,
    ListPromptsRequest,
    ListPromptsResult,
    GetPromptRequest,
    GetPromptResult,
    Tool,
    Prompt,
    Resource,
    ResourceTemplate,
    Progress,
} from "@modelcontextprotocol/sdk/types.js";
import logger from "../../../shared/utils/logger.js";
import { UpstreamConnectionPool } from "../upstream/upstream-connector-pool.js";
import { IConnectorFactory } from "../upstream/upstream-connector-factory.js";
import { LoadingStrategy } from "./loading/loading-strategy.js";
import { BundlerStage } from "./stage.js";
import { attachStageUpstreams } from "./loading/attach-stage-upstreams.js";
import { BundlerMiddleware, MiddlewareContext } from "../middleware/middleware.js";
import { MiddlewareChain } from "../middleware/middleware-chain.js";
import { SessionStateStore } from "./session-state-store.js";

/**
 * Operation types for resumption token tracking
 */
type ResumableOperation = "list_tools" | "call_tool" | "list_resources" | "read_resource" |
    "list_resource_templates" | "list_prompts" | "get_prompt";

export const SESSION_EVENTS = {
    CONNECTED: "connected",
    LIST_TOOLS: "list_tools",
    CALL_TOOL: "call_tool",
    LIST_RESOURCES: "list_resources",
    LIST_RESOURCE_TEMPLATES: "list_resource_templates",
    READ_RESOURCE: "read_resource",
    LIST_PROMPTS: "list_prompts",
    GET_PROMPT: "get_prompt",
    SHUTDOWN: "shutdown",
    // Notification events for list_changed forwarding to clients
    NOTIFY_TOOLS_CHANGED: "notify_tools_changed",
    NOTIFY_RESOURCES_CHANGED: "notify_resources_changed",
    NOTIFY_PROMPTS_CHANGED: "notify_prompts_changed",
} as const;

export enum SessionState {
    Active = "active",
    Terminated = "terminated"
}

interface DomainEvent {
    eventType: string;
    occurredAt: Date;
    [key: string]: unknown;
}

export class Session extends EventEmitter {
    readonly id: string;
    readonly bundleId: string;
    accessToken: string;
    readonly createdAt: Date;
    private namespaceService: INamespaceService | null;
    private permissionService: IPermissionService | null;
    private connectorFactory: IConnectorFactory | null;
    private connectionPool: UpstreamConnectionPool | null;
    private upstreams: Map<string, IUpstreamConnector> = new Map();
    private _state: SessionState;
    private _lastActivityAt: Date;
    private domainEvents: DomainEvent[] = [];
    private eventCoordinator: UpstreamEventCoordinator;
    private idleCheckInterval?: NodeJS.Timeout;
    private readonly idleTimeoutMs: number = 5 * 60 * 1000; // 5 minutes default

    // Configurable upstream request timeout (default 30 seconds)
    private readonly upstreamTimeoutMs: number = 30000;

    private loadingStrategy: LoadingStrategy = LoadingStrategy.EAGER;
    private availableUpstreams: MCPConfig[] = [];
    private currentStage: BundlerStage | null = null;
    private readonly middlewareChain: MiddlewareChain = new MiddlewareChain();
    private readonly stateStore: SessionStateStore;

    constructor(
        id: string,
        bundleId: string,
        accessToken: string,
        createdAt: Date,
        namespaceService: INamespaceService | null,
        permissionService: IPermissionService | null,
        connectorFactory: IConnectorFactory | null,
        connectionPool: UpstreamConnectionPool | null,
        lastActivityAt: Date,
        state: SessionState,
        stateStore: SessionStateStore
    ) {
        super();
        this.id = id;
        this.bundleId = bundleId;
        this.accessToken = accessToken;
        this.createdAt = createdAt;
        this.namespaceService = namespaceService;
        this.permissionService = permissionService;
        this.connectorFactory = connectorFactory;
        this.connectionPool = connectionPool;
        this._lastActivityAt = lastActivityAt;
        this._state = state;
        this.stateStore = stateStore;
        this.eventCoordinator = new UpstreamEventCoordinator(id);

        // Wire up notification forwarding from event coordinator to session events
        this.setupNotificationForwarding();
    }

    /**
     * Forward list_changed notifications from UpstreamEventCoordinator to session events.
     * Routes can listen to these events and forward to the client transport.
     */
    private setupNotificationForwarding(): void {
        // The UpstreamEventCoordinator debounces upstream events and re-emits them
        // under the "notify_*" names (not the raw UPSTREAM_EVENTS names). Listen
        // to those debounced events and forward them to the session's NOTIFY_* events.
        this.eventCoordinator.on("notify_tools_changed", (notification) => {
            this.emit(SESSION_EVENTS.NOTIFY_TOOLS_CHANGED, notification);
        });
        this.eventCoordinator.on("notify_resources_changed", (notification) => {
            this.emit(SESSION_EVENTS.NOTIFY_RESOURCES_CHANGED, notification);
        });
        this.eventCoordinator.on("notify_prompts_changed", (notification) => {
            this.emit(SESSION_EVENTS.NOTIFY_PROMPTS_CHANGED, notification);
        });
    }

    /**
     * Emit list-changed notifications for all capability types.
     * Called after a new upstream connects (PROGRESSIVE mode) or when middleware
     * reshapes the visible tool set.
     */
    emitListChanged(): void {
        this.emit(SESSION_EVENTS.NOTIFY_TOOLS_CHANGED, {});
        this.emit(SESSION_EVENTS.NOTIFY_RESOURCES_CHANGED, {});
        this.emit(SESSION_EVENTS.NOTIFY_PROMPTS_CHANGED, {});
    }


    // Loading Strategy

    setLoadingStrategy(strategy: LoadingStrategy): void {
        this.loadingStrategy = strategy;
        logger.debug({ sessionId: this.id, strategy }, "Loading strategy updated");
    }

    getLoadingStrategy(): LoadingStrategy {
        return this.loadingStrategy;
    }


    // Available Upstreams Catalog (full bundle, attached and unattached)
    setAvailableUpstreams(configs: MCPConfig[]): void {
        this.availableUpstreams = configs;
    }

    // Middleware Management
    addMiddleware(middleware: BundlerMiddleware): void {
        this.middlewareChain.add(middleware);
        logger.debug({ sessionId: this.id, middleware: middleware.name }, "Middleware added");
    }

    async removeMiddleware(name: string): Promise<boolean> {
        const middleware = this.middlewareChain.get(name);
        if (!middleware) return false;

        this.middlewareChain.remove(name);

        try {
            await middleware.teardown();
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ sessionId: this.id, middleware: name, err: msg }, "Middleware teardown failed during removal");
        }

        logger.debug({ sessionId: this.id, middleware: name }, "Middleware removed");
        return true;
    }

    getMiddlewareNames(): string[] {
        return this.middlewareChain.getNames();
    }

    /**
     * Updates the token this session's middleware/telemetry reads for
     * subsequent authenticated calls to the backend. Anonymous sessions are
     * constructed with an empty accessToken (nothing to authenticate with
     * yet); a device-flow transition to a real bundle is the one place that
     * changes after construction, once Keycloak has approved a human and the
     * deployment-bootstrap endpoint has minted a real bundle token.
     * getMiddlewareContext() reads session.accessToken live on every call
     * (not a value captured at session-creation time), so this takes effect
     * immediately for the next tool call - no re-registration needed.
     */
    setAccessToken(token: string): void {
        this.accessToken = token;
    }

    // Stage Management

    getCurrentStage(): BundlerStage | null {
        return this.currentStage;
    }

    /**
     * Record a session's initial stage without running the unload/load
     * sequence - for a session whose first stage's middlewares/upstreams
     * were already installed directly during construction, so there is
     * nothing to unload yet. A later transitionTo call uses this as its
     * previousStage, so that initial stage's middlewares get torn down
     * correctly when the session moves on to a new one.
     */
    setCurrentStage(stage: BundlerStage): void {
        this.currentStage = stage;
        this.setLoadingStrategy(stage.loadingStrategy);
        this.setAvailableUpstreams(stage.upstreams);
    }

    /**
     * Move this session from its current stage to a new one in place - same
     * session ID, same transport connection, only the active middlewares
     * and upstreams change.
     *
     * Unload: remove the outgoing stage's middlewares. Each removal runs
     * that middleware's teardown() hook (see removeMiddleware), so a future
     * middleware holding real resources has somewhere to release them.
     * Load: install the incoming stage's middlewares.
     * Attach: bring the incoming stage's upstreams online per its loading
     * strategy, via the same eager/progressive helper session bootstrap
     * uses (attachStageUpstreams).
     * Notify: emit list_changed for the middleware swap only after
     * attachStageUpstreams returns, not before - EAGER's attach is awaited
     * here, so an emit placed earlier would tell the client its tools
     * changed while the incoming stage's upstream tools are still
     * connecting, and a client that reacts by immediately calling
     * tools/list would get an incomplete list. Placing it after means this
     * emit is redundant with the one EAGER's attachStageUpstreams already
     * fires internally, which is an accepted extra notify, not a
     * correctness issue. PROGRESSIVE does not await its upstream attach, so
     * this emit still lands right after the middleware swap for that
     * strategy; each upstream's own attach call notifies the client again
     * as it comes online (see Session.attachUpstream).
     *
     * Upstream teardown for the outgoing stage is deliberately not
     * implemented - every transition this system builds moves from a stage
     * with zero upstreams (anonymous) to one with upstreams to add, never
     * the reverse. A previous stage that does carry upstreams is logged,
     * not torn down.
     */
    async transitionTo(newStage: BundlerStage): Promise<void> {
        this.ensureActive();
        const previousStage = this.currentStage;

        if (previousStage) {
            if (previousStage.upstreams.length > 0) {
                logger.warn({
                    sessionId: this.id,
                    fromStage: previousStage.name,
                    toStage: newStage.name,
                    upstreamCount: previousStage.upstreams.length,
                }, "transitionTo does not tear down the outgoing stage's upstreams - they remain attached");
            }
            for (const middleware of previousStage.middlewares) {
                await this.removeMiddleware(middleware.name);
            }
        }

        for (const middleware of newStage.middlewares) {
            if (!this.middlewareChain.get(middleware.name)) {
                this.addMiddleware(middleware);
            }
        }

        this.setCurrentStage(newStage);

        await attachStageUpstreams(this, newStage.upstreams, newStage.loadingStrategy);
        this.emitListChanged();

        logger.info({
            sessionId: this.id,
            fromStage: previousStage?.name ?? null,
            toStage: newStage.name,
        }, "Session transitioned to new stage");
    }

    /**
     * Build a MiddlewareContext bound to this session.
     * All reads are live closures over session state so the object can be
     * recreated cheaply on each call without staleness risk.
     */
    getMiddlewareContext(): MiddlewareContext {
        const session = this;
        return {
            get sessionId() { return session.id; },
            get bundleId() { return session.bundleId; },
            get accessToken() { return session.accessToken; },
            get loadingStrategy() { return session.loadingStrategy; },

            notifyToolsChanged: () => session.emit(SESSION_EVENTS.NOTIFY_TOOLS_CHANGED, {}),
            notifyResourcesChanged: () => session.emit(SESSION_EVENTS.NOTIFY_RESOURCES_CHANGED, {}),
            notifyPromptsChanged: () => session.emit(SESSION_EVENTS.NOTIFY_PROMPTS_CHANGED, {}),

            attachUpstream: (config: MCPConfig) => session.attachUpstream(config),
            detachUpstream: (namespace: string) => session.detachUpstream(namespace),

            getAttachedNamespaces: () => Array.from(session.upstreams.keys()),
            getAvailableUpstreams: () => [...session.availableUpstreams],
        };
    }

    /**
     * Build RequestOptions with resumption token support and timeout.
     * Resumption tokens are plain, connection-less decision-state, so they are
     * held in the SessionStateStore rather than a private field - see
     * session-state-store.ts.
     */
    private async buildRequestOptions(namespace: string, operation: ResumableOperation): Promise<RequestOptions> {
        const key = this.resumptionTokenKey(namespace, operation);
        const resumptionToken = await this.stateStore.get<string>(this.id, key);
        return {
            timeout: this.upstreamTimeoutMs,
            resumptionToken,
            onresumptiontoken: (token: string) => {
                this.stateStore.set(this.id, key, token)
                    .then(() => logger.debug({ sessionId: this.id, namespace, operation }, "Resumption token updated"))
                    .catch((err) => logger.error(
                        { sessionId: this.id, namespace, operation, err: err instanceof Error ? err.message : String(err) },
                        "Failed to persist resumption token"
                    ));
            },
            onprogress: (progress: Progress) => {
                logger.debug({ sessionId: this.id, namespace, operation, progress }, "Operation progress");
            }
        };
    }

    private resumptionTokenKey(namespace: string, operation: ResumableOperation): string {
        return `resumption:${namespace}:${operation}`;
    }

    static create(
        id: string,
        bundleId: string,
        accessToken: string,
        namespaceService: INamespaceService,
        permissionService: IPermissionService,
        connectorFactory: IConnectorFactory,
        connectionPool: UpstreamConnectionPool,
        stateStore: SessionStateStore
    ): Session {
        const now = new Date();
        const session = new Session(id, bundleId, accessToken, now, namespaceService, permissionService, connectorFactory, connectionPool, now, SessionState.Active, stateStore);
        session.addDomainEvent(createSessionEstablished(id, bundleId));
        return session;
    }

    // Upstream Management
    async attachUpstream(config: MCPConfig): Promise<void> {
        if (this._state === SessionState.Terminated) {
            throw new Error("Cannot attach upstream to terminated session");
        }
        if (this.upstreams.has(config.namespace)) {
            throw new Error(`Namespace ${config.namespace} already attached`);
        }
        if (!this.connectorFactory || !this.namespaceService || !this.permissionService || !this.connectionPool) {
            throw new Error("Session not initialized with required services");
        }

        let connector: IUpstreamConnector;
        let isFromPool = false;

        // Session controls pooling strategy
        if (config.pooled && this.connectionPool.has(config.namespace, config.url)) {
            connector = this.connectionPool.get(config.namespace, config.url)!;
            isFromPool = true;
            logger.debug({ sessionId: this.id, namespace: config.namespace }, "Reusing pooled upstream connector");
        } else {
            connector = await this.connectorFactory.createConnector(config, this.namespaceService, this.permissionService);
            if (config.pooled) {
                this.connectionPool.set(config.namespace, config.url, connector);
                logger.debug({ sessionId: this.id, namespace: config.namespace }, "Created pooled upstream connector");
            } else {
                logger.debug({ sessionId: this.id, namespace: config.namespace }, "Created unpooled upstream connector");
            }
        }

        // Only connect if not already connected (pooled connectors may already be connected)
        if (!connector.isConnected()) {
            try {
                await connector.connect();
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                logger.error({ sessionId: this.id, namespace: config.namespace, error: errorMsg }, "Failed to connect to upstream");
            }
        } else if (isFromPool) {
            logger.debug({ sessionId: this.id, namespace: config.namespace }, "Pooled connector already connected, skipping connect");
        }

        // Attach upstream to event coordinator for notification handling
        this.eventCoordinator.attachUpstream(connector);
        this.upstreams.set(config.namespace, connector);
        this.recordActivity();
        this.addDomainEvent(createUpstreamConnected(this.id, config.namespace, config.url));
        logger.info({ sessionId: this.id, namespace: config.namespace, url: config.url }, "Upstream attached");

        // In PROGRESSIVE and ROUTER modes notify the client that the tool list has grown —
        // but only if the upstream actually connected (a failed upstream adds no tools).
        if (this.loadingStrategy === LoadingStrategy.PROGRESSIVE && connector.isConnected()) {
            this.emitListChanged();
        }

        // Inform middleware so it can react (e.g. LLM router can include this
        // upstream's tools in its next ranking pass).
        await this.middlewareChain.onUpstreamAttached(config.namespace, this.getMiddlewareContext());
    }

    detachUpstream(namespace: string): void {
        if (!this.upstreams.has(namespace)) {
            throw new Error(`Namespace ${namespace} not found`);
        }
        this.upstreams.delete(namespace);
    }

    getUpstream(namespace: string): IUpstreamConnector | undefined {
        return this.upstreams.get(namespace);
    }

    getAllUpstreams(): IUpstreamConnector[] {
        return Array.from(this.upstreams.values());
    }

    // MCP Aggregation Operations

    /**
     * Collect tools from all upstreams.
     * FilteredUpstreamConnector handles namespacing and permission filtering.
     */
    async listTools(params?: ListToolsRequest["params"]): Promise<ListToolsResult> {
        this.ensureActive();
        const allTools: Tool[] = [];

        for (const [namespace, connector] of this.upstreams) {
            if (!connector.isConnected()) {
                logger.warn({ sessionId: this.id, namespace }, "Upstream not connected, skipping");
                continue;
            }

            // Check if upstream supports tools capability
            const capabilities = connector.getCapabilities();
            if (!capabilities?.tools) {
                logger.debug({ sessionId: this.id, namespace }, "Upstream has no tools capability, skipping");
                continue;
            }

            try {
                const options = await this.buildRequestOptions(namespace, "list_tools");
                const result = await connector.listTools(params, options);
                allTools.push(...result.tools);

                logger.debug({ sessionId: this.id, namespace, count: result.tools.length }, "Listed tools from upstream");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.id, namespace, error: msg }, "Failed to list tools from upstream");
            }
        }

        this.recordActivity();
        const filtered = await this.middlewareChain.transformToolList(allTools, this.getMiddlewareContext());
        return { tools: filtered };
    }

    /**
     * Route tool call to the correct upstream based on namespace prefix.
     * FilteredUpstreamConnector handles permission checking and name extraction.
     */
    async callTool(params: CallToolRequest["params"]): Promise<CallToolResult> {
        this.ensureActive();

        const ctx = this.getMiddlewareContext();

        // Runs before handleOwnToolCall now, not after - a middleware-owned
        // tool (e.g. bundler__set_context, which performs a real LLM call)
        // is not automatically free just because it is not routed to an
        // upstream. A spend-check denial here short-circuits before any
        // owning middleware's side effects run. MiddlewareChain.onBeforeToolCall
        // never throws - middleware errors are caught and logged internally -
        // so this call is safe outside the try block below.
        const beforeResult = await this.middlewareChain.onBeforeToolCall(params, ctx);
        if (beforeResult) {
            this.recordActivity();
            return beforeResult;
        }

        // Middleware-owned tools (e.g. bundler__set_context) are handled here before
        // any upstream routing. First non-null result short-circuits the call.
        const ownResult = await this.middlewareChain.handleOwnToolCall(params, ctx);
        if (ownResult !== null) {
            this.recordActivity();
            return ownResult;
        }

        if (!this.namespaceService) {
            return { content: [], isError: true };
        }

        let namespace: string | undefined;
        try {
            // Extract namespace to route to correct upstream
            const extracted = this.namespaceService.extractNamespaceFromName(params.name);
            namespace = extracted.namespace;
            const connector = this.upstreams.get(namespace);

            if (!connector) {
                logger.warn({ sessionId: this.id, namespace, tool: params.name }, "Unknown namespace for tool call");
                return {
                    content: [{ type: "text", text: `Unknown namespace: ${namespace}` }],
                    isError: true
                };
            }

            if (!connector.isConnected()) {
                return {
                    content: [{ type: "text", text: `Upstream ${namespace} not connected` }],
                    isError: true
                };
            }

            // Forward params with resumption support - connector handles namespace extraction and permission check
            const options = await this.buildRequestOptions(namespace, "call_tool");
            const rawResult = await connector.callTool(params, options);
            const result = await this.middlewareChain.onAfterToolCall(params, rawResult, ctx);

            this.recordActivity();
            logger.debug({ sessionId: this.id, namespace, tool: params.name }, "Tool call completed");
            return result;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error({ sessionId: this.id, tool: params.name, error: msg }, "Tool call failed");
            return {
                content: [{ type: "text", text: msg }],
                isError: true
            };
        }
    }

    /**
     * Collect resources from all upstreams.
     * FilteredUpstreamConnector handles namespacing and permission filtering.
     */
    async listResources(params?: ListResourcesRequest["params"]): Promise<ListResourcesResult> {
        this.ensureActive();
        const allResources: Resource[] = [];

        for (const [namespace, connector] of this.upstreams) {
            if (!connector.isConnected()) {
                logger.warn({ sessionId: this.id, namespace }, "Upstream not connected, skipping");
                continue;
            }

            // Check if upstream supports resources capability
            const capabilities = connector.getCapabilities();
            if (!capabilities?.resources) {
                logger.debug({ sessionId: this.id, namespace }, "Upstream has no resources capability, skipping");
                continue;
            }

            try {
                const options = await this.buildRequestOptions(namespace, "list_resources");
                const result = await connector.listResources(params, options);
                allResources.push(...result.resources);

                logger.debug({ sessionId: this.id, namespace, count: result.resources.length }, "Listed resources from upstream");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.id, namespace, error: msg }, "Failed to list resources from upstream");
            }
        }

        this.recordActivity();
        const filtered = await this.middlewareChain.transformResourceList(allResources, this.getMiddlewareContext());
        return { resources: filtered };
    }

    /**
     * Route resource read to the correct upstream based on namespace in URI.
     * FilteredUpstreamConnector handles permission checking and URI extraction.
     */
    async readResource(params: ReadResourceRequest["params"]): Promise<ReadResourceResult> {
        this.ensureActive();

        const ctx = this.getMiddlewareContext();

        // Reuses the same tool-call gate tool calls are billed through - the
        // gate itself is generic (any CallToolResult-shaped denial), so a
        // synthetic params.name lets a resource read run through the exact
        // same accounting path a tool call does, rather than needing a
        // parallel resource-specific spend-check entry point. A denial has
        // no ReadResourceResult shape to return, so it is surfaced as a
        // thrown error instead - the MCP SDK's mechanism for a resource
        // request failing.
        const gateResult = await this.middlewareChain.onBeforeToolCall(
            { name: `resource:${params.uri}`, arguments: {} }, ctx,
        );
        if (gateResult) {
            this.recordActivity();
            const text = gateResult.content?.[0]?.type === "text" ? gateResult.content[0].text : "Access denied";
            throw new Error(text);
        }

        if (!this.namespaceService) {
            return { contents: [] };
        }

        let namespace: string | undefined;
        try {
            // Extract namespace from URI query parameter
            const extracted = this.namespaceService.extractNamespaceFromUri(params.uri);
            namespace = extracted.namespace;

            if (!namespace) {
                logger.warn({ sessionId: this.id, uri: params.uri }, "No namespace in resource URI");
                return { contents: [] };
            }

            const connector = this.upstreams.get(namespace);

            if (!connector) {
                logger.warn({ sessionId: this.id, namespace, uri: params.uri }, "Unknown namespace for resource read");
                return { contents: [] };
            }

            if (!connector.isConnected()) {
                return { contents: [] };
            }

            // Forward params with resumption support - connector handles namespace extraction and permission check
            const options = await this.buildRequestOptions(namespace, "read_resource");
            const result = await connector.readResource(params, options);

            this.recordActivity();
            logger.debug({ sessionId: this.id, namespace, uri: params.uri }, "Resource read completed");
            return result;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error({ sessionId: this.id, uri: params.uri, error: msg }, "Resource read failed");
            return { contents: [] };
        }
    }

    /**
     * Collect resource templates from all upstreams.
     * FilteredUpstreamConnector handles namespacing and permission filtering.
     */
    async listResourceTemplates(params?: ListResourceTemplatesRequest["params"]): Promise<ListResourceTemplatesResult> {
        this.ensureActive();
        const allTemplates: ResourceTemplate[] = [];

        for (const [namespace, connector] of this.upstreams) {
            if (!connector.isConnected()) {
                logger.warn({ sessionId: this.id, namespace }, "Upstream not connected, skipping");
                continue;
            }

            // Check if upstream supports resources capability (templates are part of resources)
            const capabilities = connector.getCapabilities();
            if (!capabilities?.resources) {
                logger.debug({ sessionId: this.id, namespace }, "Upstream has no resources capability, skipping templates");
                continue;
            }

            try {
                const options = await this.buildRequestOptions(namespace, "list_resource_templates");
                const result = await connector.listResourceTemplates(params, options);
                allTemplates.push(...result.resourceTemplates);

                logger.debug({ sessionId: this.id, namespace, count: result.resourceTemplates.length }, "Listed resource templates from upstream");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.id, namespace, error: msg }, "Failed to list resource templates from upstream");
            }
        }

        this.recordActivity();
        return { resourceTemplates: allTemplates };
    }

    /**
     * Collect prompts from all upstreams.
     * FilteredUpstreamConnector handles namespacing and permission filtering.
     */
    async listPrompts(params?: ListPromptsRequest["params"]): Promise<ListPromptsResult> {
        this.ensureActive();
        const allPrompts: Prompt[] = [];

        for (const [namespace, connector] of this.upstreams) {
            if (!connector.isConnected()) {
                logger.warn({ sessionId: this.id, namespace }, "Upstream not connected, skipping");
                continue;
            }

            // Check if upstream supports prompts capability
            const capabilities = connector.getCapabilities();
            if (!capabilities?.prompts) {
                logger.debug({ sessionId: this.id, namespace }, "Upstream has no prompts capability, skipping");
                continue;
            }

            try {
                const options = await this.buildRequestOptions(namespace, "list_prompts");
                const result = await connector.listPrompts(params, options);
                allPrompts.push(...result.prompts);
                logger.debug({ sessionId: this.id, namespace, count: result.prompts.length }, "Listed prompts from upstream");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.id, namespace, error: msg }, "Failed to list prompts from upstream");
            }
        }

        this.recordActivity();
        const filtered = await this.middlewareChain.transformPromptList(allPrompts, this.getMiddlewareContext());
        return { prompts: filtered };
    }

    /**
     * Route prompt get to the correct upstream based on namespace prefix.
     * FilteredUpstreamConnector handles permission checking and name extraction.
     */
    async getPrompt(params: GetPromptRequest["params"]): Promise<GetPromptResult> {
        this.ensureActive();

        const ctx = this.getMiddlewareContext();

        // Same synthetic-name gate as readResource - see its comment for why.
        const gateResult = await this.middlewareChain.onBeforeToolCall(
            { name: `prompt:${params.name}`, arguments: params.arguments ?? {} }, ctx,
        );
        if (gateResult) {
            this.recordActivity();
            const text = gateResult.content?.[0]?.type === "text" ? gateResult.content[0].text : "Access denied";
            throw new Error(text);
        }

        if (!this.namespaceService) {
            return { messages: [] };
        }

        try {
            // Extract namespace from prefixed name
            const { namespace } = this.namespaceService.extractNamespaceFromName(params.name);
            const connector = this.upstreams.get(namespace);

            if (!connector) {
                logger.warn({ sessionId: this.id, namespace, prompt: params.name }, "Unknown namespace for prompt get");
                return { messages: [] };
            }

            if (!connector.isConnected()) {
                return { messages: [] };
            }

            // Forward params with resumption support - connector handles namespace extraction and permission check
            const options = await this.buildRequestOptions(namespace, "get_prompt");
            const result = await connector.getPrompt(params, options);
            this.recordActivity();
            logger.debug({ sessionId: this.id, namespace, prompt: params.name }, "Prompt get completed");
            return result;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error({ sessionId: this.id, prompt: params.name, error: msg }, "Prompt get failed");
            return { messages: [] };
        }
    }

    // Domain Event Management
    addDomainEvent(event: DomainEvent): void {
        this.domainEvents.push(event);
    }

    getDomainEvents(): DomainEvent[] {
        return [...this.domainEvents];
    }

    clearDomainEvents(): void {
        this.domainEvents = [];
    }

    // Lifecycle Management
    recordActivity(): void {
        this._lastActivityAt = new Date();
    }

    /**
     * Get time since last activity in milliseconds
     */
    getTimeSinceLastActivity(): number {
        return Date.now() - this._lastActivityAt.getTime();
    }

    /**
     * Start monitoring for idle timeout. Emits SHUTDOWN when idle too long.
     */
    startIdleMonitoring(): void {
        if (this.idleCheckInterval) {
            clearInterval(this.idleCheckInterval);
        }

        this.idleCheckInterval = setInterval(() => {
            if (this.isIdle(this.idleTimeoutMs)) {
                logger.info({ sessionId: this.id, idleTimeMs: this.getTimeSinceLastActivity() }, "Session idle timeout reached");
                this.emit(SESSION_EVENTS.SHUTDOWN);
            }
        }, 60000); // Check every minute

        logger.debug({ sessionId: this.id, idleTimeoutMs: this.idleTimeoutMs }, "Started idle monitoring");
    }

    /**
     * Stop idle monitoring
     */
    stopIdleMonitoring(): void {
        if (this.idleCheckInterval) {
            clearInterval(this.idleCheckInterval);
            this.idleCheckInterval = undefined;
            logger.debug({ sessionId: this.id }, "Stopped idle monitoring");
        }
    }

    terminate(reason: string): void {
        if (this._state === SessionState.Terminated) {
            return;
        }
        this._state = SessionState.Terminated;
        this.stopIdleMonitoring();
        logger.info({ sessionId: this.id, reason }, "Session terminated");
    }

    async close(reason: string = "client_closed"): Promise<void> {
        this.terminate(reason);
        // Teardown middleware chain before disconnecting upstreams
        await this.middlewareChain.teardown();
        // Detach all upstreams from event coordinator
        this.eventCoordinator.detachAll();
        // Disconnect upstreams that are not pooled
        for (const [namespace, connector] of this.upstreams) {
            const isPooled = this.connectionPool?.isPooled(connector) ?? false;
            if (!isPooled) {
                await connector.disconnect();
                logger.debug({ sessionId: this.id, namespace }, "Disconnected stateful upstream");
            } else {
                logger.debug({ sessionId: this.id, namespace }, "Keeping pooled upstream connector");
            }
            this.addDomainEvent(createUpstreamDisconnected(this.id, namespace, reason));
        }
        this.upstreams.clear();
        // Purge this session's bucket (resumption tokens, LLM-router decision
        // state) so InMemorySessionStateStore doesn't accumulate one entry
        // per session for the lifetime of the process.
        await this.stateStore.delete(this.id);
        // Emit shutdown event for listeners
        this.emit(SESSION_EVENTS.SHUTDOWN);
    }

    // State Accessors

    isIdle(idleTimeoutMs: number): boolean {
        const idleTime = Date.now() - this._lastActivityAt.getTime();
        return idleTime > idleTimeoutMs;
    }

    isActive(): boolean {
        return this._state === SessionState.Active;
    }

    isTerminated(): boolean {
        return this._state === SessionState.Terminated;
    }

    isClosed(): boolean {
        return this._state === SessionState.Terminated;
    }

    get state(): SessionState {
        return this._state;
    }

    get lastActivityAt(): Date {
        return this._lastActivityAt;
    }

    getEventCoordinator(): UpstreamEventCoordinator {
        return this.eventCoordinator;
    }
    // Private Helpers

    private ensureActive(): void {
        if (this._state !== SessionState.Active) {
            throw new Error("Session is not active");
        }
    }
}
