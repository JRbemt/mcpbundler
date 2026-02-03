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
import { IUpstreamConnector } from "../upstream/upstream.js";
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

    // Resumption tokens: namespace -> operation -> token
    private resumptionTokens: Map<string, Map<ResumableOperation, string>> = new Map();

    // Configurable upstream request timeout (default 30 seconds)
    private readonly upstreamTimeoutMs: number = 30000;

    constructor(
        id: string,
        bundleId: string,
        createdAt: Date,
        namespaceService: INamespaceService | null,
        permissionService: IPermissionService | null,
        connectorFactory: IConnectorFactory | null,
        connectionPool: UpstreamConnectionPool | null,
        lastActivityAt: Date,
        state: SessionState
    ) {
        super();
        this.id = id;
        this.bundleId = bundleId;
        this.createdAt = createdAt;
        this.namespaceService = namespaceService;
        this.permissionService = permissionService;
        this.connectorFactory = connectorFactory;
        this.connectionPool = connectionPool;
        this._lastActivityAt = lastActivityAt;
        this._state = state;
        this.eventCoordinator = new UpstreamEventCoordinator(id);

        // Wire up notification forwarding from event coordinator to session events
        this.setupNotificationForwarding();
    }

    /**
     * Forward list_changed notifications from UpstreamEventCoordinator to session events.
     * Routes can listen to these events and forward to the client transport.
     */
    private setupNotificationForwarding(): void {
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
     * Build RequestOptions with resumption token support and timeout.
     */
    private buildRequestOptions(namespace: string, operation: ResumableOperation): RequestOptions {
        const namespaceTokens = this.resumptionTokens.get(namespace);
        return {
            timeout: this.upstreamTimeoutMs,
            resumptionToken: namespaceTokens?.get(operation),
            onresumptiontoken: (token: string) => {
                if (!this.resumptionTokens.has(namespace)) {
                    this.resumptionTokens.set(namespace, new Map());
                }
                this.resumptionTokens.get(namespace)!.set(operation, token);
                logger.debug({ sessionId: this.id, namespace, operation }, "Resumption token updated");
            },
            onprogress: (progress: Progress) => {
                logger.debug({ sessionId: this.id, namespace, operation, progress }, "Operation progress");
            }
        };
    }

    static create(
        id: string,
        bundleId: string,
        namespaceService: INamespaceService,
        permissionService: IPermissionService,
        connectorFactory: IConnectorFactory,
        connectionPool: UpstreamConnectionPool
    ): Session {
        const now = new Date();
        const session = new Session(id, bundleId, now, namespaceService, permissionService, connectorFactory, connectionPool, now, SessionState.Active);
        session.addDomainEvent(createSessionEstablished(id, bundleId));
        return session;
    }

    static reconstitute(
        id: string,
        bundleId: string,
        createdAt: Date,
        lastActivityAt: Date,
        state: SessionState,
        upstreams: Map<string, IUpstreamConnector>
    ): Session {
        const session = new Session(id, bundleId, createdAt, null, null, null, null, lastActivityAt, state);
        session.upstreams = upstreams;
        return session;
    }

    // =========================================================================
    // Upstream Management
    // =========================================================================

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
        if (config.stateless && this.connectionPool.has(config.namespace, config.url)) {
            connector = this.connectionPool.get(config.namespace, config.url)!;
            isFromPool = true;
            logger.debug({ sessionId: this.id, namespace: config.namespace }, "Reusing stateless upstream from pool");
        } else {
            connector = await this.connectorFactory.createConnector(config, this.namespaceService, this.permissionService);
            if (config.stateless) {
                this.connectionPool.set(config.namespace, config.url, connector);
                logger.debug({ sessionId: this.id, namespace: config.namespace }, "Created stateless upstream in pool");
            } else {
                logger.debug({ sessionId: this.id, namespace: config.namespace }, "Created stateful upstream");
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

    /**
     * Connect all attached upstreams. Called after attaching upstreams.
     */
    async connect(): Promise<void> {
        // Upstreams are connected in attachUpstream, this is for compatibility
        logger.debug({ sessionId: this.id, upstreamCount: this.upstreams.size }, "Session connect called");
    }

    // =========================================================================
    // MCP Aggregation Operations
    // =========================================================================

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
                const options = this.buildRequestOptions(namespace, "list_tools");
                const result = await connector.listTools(params, options);
                allTools.push(...result.tools);

                logger.debug({ sessionId: this.id, namespace, count: result.tools.length }, "Listed tools from upstream");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.id, namespace, error: msg }, "Failed to list tools from upstream");
            }
        }

        this.recordActivity();
        return { tools: allTools };
    }

    /**
     * Route tool call to the correct upstream based on namespace prefix.
     * FilteredUpstreamConnector handles permission checking and name extraction.
     */
    async callTool(params: CallToolRequest["params"]): Promise<CallToolResult> {
        this.ensureActive();

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
            const options = this.buildRequestOptions(namespace, "call_tool");
            const result = await connector.callTool(params, options);

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
                const options = this.buildRequestOptions(namespace, "list_resources");
                const result = await connector.listResources(params, options);
                allResources.push(...result.resources);

                logger.debug({ sessionId: this.id, namespace, count: result.resources.length }, "Listed resources from upstream");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.id, namespace, error: msg }, "Failed to list resources from upstream");
            }
        }

        this.recordActivity();
        return { resources: allResources };
    }

    /**
     * Route resource read to the correct upstream based on namespace in URI.
     * FilteredUpstreamConnector handles permission checking and URI extraction.
     */
    async readResource(params: ReadResourceRequest["params"]): Promise<ReadResourceResult> {
        this.ensureActive();

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
            const options = this.buildRequestOptions(namespace, "read_resource");
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
                const options = this.buildRequestOptions(namespace, "list_resource_templates");
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
                const options = this.buildRequestOptions(namespace, "list_prompts");
                const result = await connector.listPrompts(params, options);
                allPrompts.push(...result.prompts);
                logger.debug({ sessionId: this.id, namespace, count: result.prompts.length }, "Listed prompts from upstream");
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.id, namespace, error: msg }, "Failed to list prompts from upstream");
            }
        }

        this.recordActivity();
        return { prompts: allPrompts };
    }

    /**
     * Route prompt get to the correct upstream based on namespace prefix.
     * FilteredUpstreamConnector handles permission checking and name extraction.
     */
    async getPrompt(params: GetPromptRequest["params"]): Promise<GetPromptResult> {
        this.ensureActive();

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
            const options = this.buildRequestOptions(namespace, "get_prompt");
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

    // =========================================================================
    // Domain Event Management
    // =========================================================================

    addDomainEvent(event: DomainEvent): void {
        this.domainEvents.push(event);
    }

    getDomainEvents(): DomainEvent[] {
        return [...this.domainEvents];
    }

    clearDomainEvents(): void {
        this.domainEvents = [];
    }

    // =========================================================================
    // Lifecycle Management
    // =========================================================================

    recordActivity(): void {
        this._lastActivityAt = new Date();
    }

    /**
     * Alias for recordActivity - for compatibility with old session API
     */
    touch(): void {
        this.recordActivity();
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
        // Detach all upstreams from event coordinator
        this.eventCoordinator.detachAll();
        // Disconnect upstreams that are not pooled
        for (const [namespace, connector] of this.upstreams) {
            const isPooled = this.connectionPool?.isPooled(connector) ?? false;
            if (!isPooled) {
                await connector.disconnect();
                logger.debug({ sessionId: this.id, namespace }, "Disconnected stateful upstream");
            } else {
                logger.debug({ sessionId: this.id, namespace }, "Keeping stateless upstream in pool");
            }
            this.addDomainEvent(createUpstreamDisconnected(this.id, namespace, reason));
        }
        this.upstreams.clear();
        // Emit shutdown event for listeners
        this.emit(SESSION_EVENTS.SHUTDOWN);
    }

    // =========================================================================
    // State Accessors
    // =========================================================================

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

    // =========================================================================
    // Private Helpers
    // =========================================================================

    private ensureActive(): void {
        if (this._state !== SessionState.Active) {
            throw new Error("Session is not active");
        }
    }
}
