
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    Tool,
    CallToolRequest,
    CallToolResult,
    ListPromptsResult,
    ListResourcesResult,
    ReadResourceResult,
    ListToolsResult,
    GetPromptResult,
    ListToolsRequest,
    ListResourcesRequest,
    ListPromptsRequest,
    GetPromptRequest,
    ReadResourceRequest,
    ListResourceTemplatesRequest,
    ListResourceTemplatesResult,
    ResourceTemplate,
    Prompt,
    Resource,
    CallToolResultSchema,
    Progress
} from "@modelcontextprotocol/sdk/types.js";
import logger from "../utils/logger.js";
import EventEmitter from "events";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import crypto from "crypto";
import { Upstream, UPSTREAM_EVENTS } from "./upstream.js";
import { MeteringService } from "../services/telemetry/MeteringService.js";

/**
 * Hash modes for tool names
 */
export enum ToolNameHashMode {
    /** Never hash tool names - use namespace__toolname format */
    NEVER = 'never',
    /** Hash all tool names regardless of length */
    ALWAYS = 'always',
    /** Only hash tool names longer than specified threshold */
    THRESHOLD = 'threshold'
}

export const RESUMABLES = {
    CLIENT: "client",
    LIST_TOOLS: "list_tools",
    CALL_TOOL: "call_tool",
    LIST_RESOURCES: "list_resources",
    LIST_RESOURCE_TEMPLATES: "list_resource_templates",
    READ_RESOURCE: "read_resource",
    LIST_PROMPTS: "list_prompts",
    GET_PROMPT: "get_prompt",
} as const;


type Resumable = typeof RESUMABLES[keyof typeof RESUMABLES];


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
} as const;

/**
* Session encapsulates per-connection state and operations.
*/
export class Session extends EventEmitter {
    readonly id: string
    readonly transport: SSEServerTransport

    protected readonly upstreams: Upstream[] = []

    protected lastActivity: number = Date.now();
    private resumptionTokens: Map<string, Map<Resumable, string>> = new Map()

    private seperator: string = "__";
    private errorOnListIfUpstreamDisconnected = true;
    private upstreamTimeout: number = 5000;

    // hashing
    private hashToolNamesMode: ToolNameHashMode = ToolNameHashMode.THRESHOLD;
    private readonly hashThreshold: number = 64; // characters
    private toolLookup = new Map<string, { namespace: string, method: string, }>();

    // Metering
    private meteringService: MeteringService | null;
    private collectionId: string | null;
    private userId: string | null;

    // Notification debouncing for dynamic list changes
    private notificationDebounce = new Map<string, NodeJS.Timeout>();
    private readonly NOTIFICATION_DEBOUNCE_MS = 500;

    // Track event listeners for cleanup
    private upstreamListeners = new Map<Upstream, {
        toolsChanged: () => void;
        resourcesChanged: () => void;
        promptsChanged: () => void;
    }>();

    // Idle timeout monitoring
    private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    private idleCheckInterval: NodeJS.Timeout | null = null;

    constructor(
        transport: SSEServerTransport,
        meteringService: MeteringService | null = null,
        collectionId: string | null = null,
        userId: string | null = null
    ) {
        super();
        this.id = transport.sessionId;
        this.transport = transport;
        this.upstreams = [];
        this.meteringService = meteringService;
        this.collectionId = collectionId;
        this.userId = userId;

        [
            SESSION_EVENTS.CALL_TOOL,
            SESSION_EVENTS.LIST_TOOLS,
            SESSION_EVENTS.LIST_RESOURCES,
            SESSION_EVENTS.READ_RESOURCE,
            SESSION_EVENTS.LIST_RESOURCE_TEMPLATES,
            SESSION_EVENTS.LIST_PROMPTS,
            SESSION_EVENTS.GET_PROMPT,
        ].forEach((e) => {
            this.on(e, () => this.touch());
        });
    }

    /**
     * Check if a name matches any pattern in the allowed list
     * Supports exact matches and regex patterns
     */
    private matchesPattern(name: string, patterns: string[]): boolean {
        return patterns.some(pattern => {
            if (pattern === '*') return true;
            if (pattern === name) return true;

            try {
                const regex = new RegExp(pattern);
                return regex.test(name);
            } catch {
                return false;
            }
        });
    }

    /**
     * Check if a tool is allowed for a given upstream
     * Supports exact matches and regex patterns in allowed_tools list
     */
    private isToolAllowed(upstream: Upstream, toolName: string): boolean {
        const permissions = upstream.config.permissions;
        if (!permissions) return true; // No permissions = allow all

        const allowed = permissions.allowed_tools;
        if (allowed.length === 0) return false;   // Empty array = deny all
        return this.matchesPattern(toolName, allowed);
    }

    /**
     * Check if a resource is allowed for a given upstream
     * Supports exact matches and regex patterns in allowed_resources list
     */
    private isResourceAllowed(upstream: Upstream, resourceUri: string): boolean {
        const permissions = upstream.config.permissions;
        if (!permissions) return true; // No permissions = allow all

        const allowed = permissions.allowed_resources;
        if (allowed.length === 0) return false;     // Empty array = deny all
        return this.matchesPattern(resourceUri, allowed);
    }

    /**
     * Check if a prompt is allowed for a given upstream
     * Supports exact matches and regex patterns in allowed_prompts list
     */
    private isPromptAllowed(upstream: Upstream, promptName: string): boolean {
        const permissions = upstream.config.permissions;
        if (!permissions) return true; // No permissions = allow all

        const allowed = permissions.allowed_prompts;
        if (allowed.length === 0) return false;   // Empty array = deny all
        return this.matchesPattern(promptName, allowed);
    }

    public attach(upstream: Upstream) {
        this.upstreams.push(upstream);

        // Make sure every upstream has an entry
        this.resumptionTokens.set(upstream.getNamespace(), new Map<Resumable, string>())

        // Create bound functions to store references for cleanup
        const toolsChangedHandler = () => {
            this.handleUpstreamToolsChanged(upstream);
        };
        const resourcesChangedHandler = () => {
            this.handleUpstreamResourcesChanged(upstream);
        };
        const promptsChangedHandler = () => {
            this.handleUpstreamPromptsChanged(upstream);
        };

        // Store references for cleanup
        this.upstreamListeners.set(upstream, {
            toolsChanged: toolsChangedHandler,
            resourcesChanged: resourcesChangedHandler,
            promptsChanged: promptsChangedHandler
        });

        // Subscribe to upstream list change events
        upstream.on(UPSTREAM_EVENTS.TOOLS_LIST_CHANGED, toolsChangedHandler);
        upstream.on(UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED, resourcesChangedHandler);
        upstream.on(UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED, promptsChangedHandler);
    }

    public getId(): string {
        return this.id;
    }

    public touch(): this {
        this.lastActivity = Date.now();
        return this;
    }

    public getTimeSinceLastActivity(): number {
        return Date.now() - this.lastActivity;
    }

    /**
     * Start idle timeout monitoring
     * Should be called after session is fully initialized
     */
    public startIdleMonitoring(): void {
        // Check every minute for idle sessions
        this.idleCheckInterval = setInterval(() => {
            const idleTime = this.getTimeSinceLastActivity();

            if (idleTime > this.IDLE_TIMEOUT_MS) {
                logger.warn({
                    sessionId: this.id,
                    idleTimeMs: idleTime,
                    threshold: this.IDLE_TIMEOUT_MS
                }, 'Session idle timeout - closing');

                // Emit event for server to clean up
                this.emit('idle_timeout');

                // Close the session
                this.close().catch(err => {
                    logger.error({ sessionId: this.id, err }, 'Error closing idle session');
                });
            }
        }, 60 * 1000); // Check every minute

        logger.debug({ sessionId: this.id }, 'Idle monitoring started');
    }

    /**
     * Stop idle timeout monitoring
     */
    private stopIdleMonitoring(): void {
        if (this.idleCheckInterval) {
            clearInterval(this.idleCheckInterval);
            this.idleCheckInterval = null;
        }
    }

    public getHashMode(): ToolNameHashMode {
        return this.hashToolNamesMode;
    }

    public setHashMode(mode: ToolNameHashMode): void {
        this.hashToolNamesMode = mode;
        // Clear the tool lookup when changing modes as mappings may no longer be valid
        this.toolLookup.clear();
    }

    public async connect() {
        const tasks = this.upstreams.map(async (u) => {
            await u.connect();
        });

        await Promise.allSettled(tasks);
    }

    private ensureConnected(namespace: string) {
        const state = this.upstreams.find(u => u.getNamespace() === namespace);
        if (!state?.isConnected()) {
            throw new Error(`Upstream disconnected ${state?.getNamespace()}`)
        }
    }

    private ensureConnectedAll() {
        const disconnected = this.upstreams.filter(u => !u.isConnected());
        if ((disconnected.length > 0) && this.errorOnListIfUpstreamDisconnected) {
            throw new Error(`Upstream(s) disconnected: ${disconnected}`)
        }
    }

    /**
     * Record a metering event for tracking usage
     */
    private recordMeteringEvent(
        eventType: 'tool_call' | 'resource_read' | 'prompt_get',
        upstream: Upstream,
        toolOrResourceName: string,
        requestData: any,
        responseData: any,
        durationMs?: number
    ): void {
        if (!this.meteringService || !this.collectionId || !this.userId) {
            logger.info({ sessionId: this.id, service: this.meteringService, collectionId: this.collectionId, userId: this.userId }, "call not metered, because of missing parameter")
            return;
        }

        try {
            // Calculate bytes transferred (rough estimate from JSON serialization)
            const requestBytes = JSON.stringify(requestData).length;
            const responseBytes = JSON.stringify(responseData).length;
            const totalBytes = requestBytes + responseBytes;

            // Calculate cost based on upstream token_cost (cost per 1KB)
            const tokenCost = upstream.config.token_cost || 0.001;

            this.meteringService.recordEvent({
                event_type: eventType,
                timestamp: new Date().toISOString(),
                user_id: this.userId,
                collection_id: this.collectionId,
                session_id: this.id,
                upstream_namespace: upstream.getNamespace(),
                tool_name: toolOrResourceName,
                bytes_transferred: totalBytes,
                token_cost: tokenCost,
                duration_ms: durationMs,
            });

            logger.debug({
                event_type: eventType,
                namespace: upstream.getNamespace(),
                bytes: totalBytes,
                cost: tokenCost,
            }, 'Recorded metering event');

        } catch (error) {
            // Don't fail the request if metering fails
            logger.warn({ error, eventType }, 'Failed to record metering event');
        }
    }

    /**
     * Handle upstream tools list changed event
     */
    private handleUpstreamToolsChanged(upstream: Upstream) {
        logger.info({
            sessionId: this.id,
            namespace: upstream.getNamespace()
        }, 'Upstream tools changed');

        // Schedule debounced notification to client
        this.scheduleNotification('tools');
    }

    /**
     * Handle upstream resources list changed event
     */
    private handleUpstreamResourcesChanged(upstream: Upstream) {
        logger.info({
            sessionId: this.id,
            namespace: upstream.getNamespace()
        }, 'Upstream resources changed');

        // Schedule debounced notification to client
        this.scheduleNotification('resources');
    }

    /**
     * Handle upstream prompts list changed event
     */
    private handleUpstreamPromptsChanged(upstream: Upstream) {
        logger.info({
            sessionId: this.id,
            namespace: upstream.getNamespace()
        }, 'Upstream prompts changed');

        // Schedule debounced notification to client
        this.scheduleNotification('prompts');
    }

    /**
     * Schedule a debounced notification to the client
     * Multiple rapid changes are coalesced into a single notification
     */
    private scheduleNotification(type: 'tools' | 'resources' | 'prompts') {
        const key = `${type}_list_changed`;

        // Clear existing timer for this notification type
        if (this.notificationDebounce.has(key)) {
            clearTimeout(this.notificationDebounce.get(key)!);
        }

        // Schedule new notification after debounce period
        this.notificationDebounce.set(key, setTimeout(() => {
            this.sendNotificationToClient(type);
            this.notificationDebounce.delete(key);
        }, this.NOTIFICATION_DEBOUNCE_MS));
    }

    /**
     * Send notification to client via session event
     * Server will wire this up to MCP notification system
     */
    private sendNotificationToClient(type: 'tools' | 'resources' | 'prompts') {
        logger.info({
            sessionId: this.id,
            type
        }, 'Sending list_changed notification to client');

        // Emit event that server will forward to MCP client
        this.emit(`notify_${type}_changed`, {
            jsonrpc: '2.0' as const,
            method: `notifications/${type}/list_changed`,
            params: {}
        });
    }

    resumptionObject(namespace: string, event: Resumable, sessionId: string): RequestOptions {
        return {
            onprogress: (progress: Progress) => {
                logger.info({ progress, namespace: namespace })
            },
            resumptionToken: this.resumptionTokens.get(namespace)?.get(event),
            onresumptiontoken: (token: string) => {
                logger.info({
                    sessionId,
                    namespace: namespace,
                    event
                }, "upstream resumption token updated");
                this.resumptionTokens.get(namespace)?.set(event, token);
            },
            timeout: this.upstreamTimeout,
        } as RequestOptions
    }

    /** Resolve an upstream and local tool name from a namespaced tool. */
    private extractNamespace(namespaced_method: string): {
        namespace: string,
        method: string
    } {
        const idx = namespaced_method.indexOf(this.seperator)
        if (idx === -1) {
            throw new Error(`Missing namespace in tool name '${namespaced_method}'`);
        }
        const namespace = namespaced_method.slice(0, idx)
        return { namespace, method: namespaced_method.slice(idx + this.seperator.length) };
    }

    /**
     * Determine whether a tool name should be hashed based on the current hash mode.
     */
    private shouldHashTool(namespace: string, tool: Tool): boolean {
        switch (this.hashToolNamesMode) {
            case ToolNameHashMode.NEVER:
                return false;
            case ToolNameHashMode.ALWAYS:
                return true;
            case ToolNameHashMode.THRESHOLD:
                const fullName = `${namespace}${this.seperator}${tool.name}`;
                return fullName.length > this.hashThreshold;
            default:
                return false;
        }
    }

    /**
     * Hash a tool name deterministically, and preserve the original name in metadata.
     */
    private hashToolName(namespace: string, tool: Tool): Tool {
        // Compute SHA-256 hash (shortened for readability)
        const hash = crypto.createHash("sha256")
            .update(`${namespace}${this.seperator}${tool.name}`)
            .digest("hex")
            .slice(0, 12); // 12 chars is usually plenty; still collision-resistant

        const readableTitle = `${namespace}::${tool.name}`; // on purpose a :: for readability in UI

        this.toolLookup.set(hash, {
            namespace: namespace,
            method: tool.name
        });

        // Return both hashed name and the original for metadata
        return {
            ...tool,            // shallow clone!
            name: hash,         // programmatic name
            title: tool.title,  // human-readable title for UIs
            annotations: {
                ...(tool.annotations || {}),
                title: tool.annotations?.title ?? readableTitle,
            },
            _meta: {
                ...(tool._meta || {}),
                originalName: tool.name,
                namespace,
                hashAlgorithm: "sha256",
                hashLength: 12,
                createdBy: "mcpbundler.ai",
            },
        } as Tool;
    }

    private findByNamespace(namespace: string): Upstream {
        const upstream = this.upstreams.find((u) => u.getNamespace() === namespace);
        if (!upstream) throw new Error(`Unknown tool namespace in '${namespace}', known: ${this.upstreams.map(u => u.getNamespace())}`);
        return upstream;
    }

    /** Collect and namespace tools from all upstreams. */
    async listTools(params?: ListToolsRequest["params"]): Promise<ListToolsResult> {
        this.ensureConnectedAll();

        const tools: Tool[] = []
        for (const up of this.upstreams) {
            const client = up.getClient();
            if (!client.getServerCapabilities()?.tools) {
                logger.info({
                    sessionId: this.getId(),
                    namespace: up.getNamespace()
                }, "upstream has no tools capability");
                continue;
            }
            try {
                const result = await up.listTools(
                    params,
                    this.resumptionObject(up.getNamespace(), RESUMABLES.LIST_TOOLS, this.getId())
                );
                logger.info({
                    sessionId: this.getId(),
                    host: up.getUrl(),
                    namespace: up.getNamespace(),
                    count: result?.tools?.length || 0,
                }, "tools/list succeeded");

                if (!result?.tools?.length) continue
                for (const t of result.tools) {
                    if (this.shouldHashTool(up.getNamespace(), t)) {
                        tools.push(this.hashToolName(up.getNamespace(), t));
                    } else {
                        tools.push({
                            ...t, name: `${up.getNamespace()}${this.seperator}${t.name}`
                        });
                    }

                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.getId(), namespace: up.config.namespace, msg }, "failed to tools/list upstream")
                return {
                    tools: [],
                    isError: true,
                    error: [{ type: "text", text: msg }]
                };
            }
        }

        this.emit(SESSION_EVENTS.LIST_TOOLS, tools);
        return {
            tools,
        };
    }


    /** Call a namespaced tool like "files/read_file" on the correct upstream. */
    async callTool(params: CallToolRequest["params"]): Promise<CallToolResult> {
        const startTime = Date.now();
        try {
            let namespace: string, method: string;

            // First try to find in hash lookup table (for hashed tools)
            const lookup = this.toolLookup.get(params.name);
            if (lookup) {
                ({ namespace, method } = lookup);
            } else {
                // If not found in lookup, assume it's a non-hashed namespaced tool
                ({ namespace, method } = this.extractNamespace(params.name));
            }
            this.ensureConnected(namespace);
            const up = this.findByNamespace(namespace);

            // Check permissions
            if (!this.isToolAllowed(up, method)) {
                logger.warn({
                    sessionId: this.getId(),
                    namespace,
                    tool: method
                }, 'Tool call denied by permissions');
                return {
                    content: [],
                    isError: true,
                    error: [{ type: "text", text: `Permission denied: tool '${method}' is not allowed for this MCP` }]
                };
            }

            const result = await up.callTool(
                {
                    name: method,
                    arguments: params.arguments,
                    _meta: params._meta,
                },
                CallToolResultSchema,
                this.resumptionObject(up.getNamespace(), RESUMABLES.CALL_TOOL, this.getId())
            );

            const durationMs = Date.now() - startTime;

            // Record metering event
            this.recordMeteringEvent(
                'tool_call',
                up,
                method,
                params,
                result,
                durationMs
            );

            logger.info({ sessionId: this.getId(), namespace, method }, "tools/call succeeded");
            this.emit(SESSION_EVENTS.CALL_TOOL, method, params.arguments);
            return result as CallToolResult;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error({
                sessionId: this.getId(),
                method: params.name,
                msg
            }, "failed to tools/call upstream");
            return {
                content: [],
                isError: true,
                error: [{ type: "text", text: msg }]
            };
        }
    }

    /** Collect and namespace resources from all upstreams. */
    async listResources(params?: ListResourcesRequest["params"]): Promise<ListResourcesResult> {
        this.ensureConnectedAll();

        const resources: Resource[] = [];
        for (const up of this.upstreams) {
            try {
                if (!up.getServerCapabilities()?.resources) {
                    logger.info({ sessionId: this.getId(), namespace: up.getNamespace() }, "upstream has no resources capability");
                    continue;
                }
                const list = await up.listResources(
                    params,
                    this.resumptionObject(up.getNamespace(), RESUMABLES.LIST_RESOURCES, this.getId())
                );
                const arr = list?.resources ?? [];
                logger.info({
                    sessionId: this.id,
                    namespace: up.getNamespace(),
                    count: arr.length,
                }, "resource/list succeeded");

                for (const r of arr) {
                    // Keep everything, rewrite only the URI
                    resources.push({ ...r, uri: `${up.getNamespace()}${this.seperator}${r.uri}` });
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.getId(), namespace: up.getNamespace(), msg }, "failed to resources/list upstream");
                return {
                    resources: [],
                    isError: true,
                    error: [{ type: "text", text: msg }]
                };
            }
        }
        this.emit(SESSION_EVENTS.LIST_RESOURCES, resources);
        return {
            resources
        };
    }

    /** Read a resource by bundled URI (e.g., mcp://files/r/<encoded-origin-uri>). */
    async readResource(params: ReadResourceRequest["params"]): Promise<ReadResourceResult> {
        const uri: string = params.uri;
        const startTime = Date.now();
        try {
            const { namespace, method } = this.extractNamespace(uri);
            this.ensureConnected(namespace);
            const up = this.findByNamespace(namespace);

            // Check permissions
            if (!this.isResourceAllowed(up, method)) {
                logger.warn({
                    sessionId: this.getId(),
                    namespace,
                    resource: method
                }, 'Resource read denied by permissions');
                return {
                    contents: [],
                    isError: true,
                    error: [{ type: "text", text: `Permission denied: resource '${method}' is not allowed for this MCP` }]
                };
            }

            // Pass-through other params like byte ranges if supplied
            const passthrough = { ...(params || {}), uri: method };
            const resource = await up.readResource(
                passthrough,
                this.resumptionObject(up.getNamespace(), RESUMABLES.READ_RESOURCE, this.getId())
            );

            const durationMs = Date.now() - startTime;

            // Record metering event
            this.recordMeteringEvent(
                'resource_read',
                up,
                method,
                params,
                resource,
                durationMs
            );

            logger.info({ sessionId: this.getId(), namespace: namespace, uri: method }, "resources/read succeeded");
            this.emit(SESSION_EVENTS.READ_RESOURCE, resource);
            return resource;

        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error({ sessionId: this.getId(), uri: params.uri, msg }, "failed to resources/read upstream");
            return {
                contents: [],
                isError: true,
                error: [{ type: "text", text: msg }]
            };
        }
    }

    /** Collect and namespace resource templates from all upstreams. */
    async listResourceTemplates(params?: ListResourceTemplatesRequest["params"]): Promise<ListResourceTemplatesResult> {
        this.ensureConnectedAll();

        const resourceTemplates: ResourceTemplate[] = [];

        for (const up of this.upstreams) {
            try {
                if (!up.getServerCapabilities()?.resourceTemplates) {
                    logger.info({ sessionId: this.getId(), namespace: up.config.namespace }, "upstream has no resourceTemplates capability");
                    continue;
                }

                const list = await up.listResourceTemplates(
                    params,
                    this.resumptionObject(up.getNamespace(), RESUMABLES.LIST_RESOURCE_TEMPLATES, this.getId())
                );

                const arr = list?.resourceTemplates ?? [];
                logger.info({
                    host: up.getUrl(),
                    namespace: up.getNamespace(),
                    count: arr.length,
                }, "fetched resourceTemplates from upstream");

                for (const t of arr) {
                    // Keep everything, rewrite only the URI
                    resourceTemplates.push({ ...t, uri: `${up.getNamespace()}${this.seperator}${t.uri}` });
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.getId(), namespace: up.config.namespace, msg }, "failed to resources/templates/list upstream");
                return {
                    resourceTemplates: [],
                    isError: true,
                    error: [{ type: "text", text: msg }]
                };
            }
        }

        this.emit(SESSION_EVENTS.LIST_RESOURCE_TEMPLATES, resourceTemplates);
        return { resourceTemplates };
    }



    /** Collect and namespace prompts from all upstreams. */
    async listPrompts(params?: ListPromptsRequest["params"]): Promise<ListPromptsResult> {
        this.ensureConnectedAll();

        const prompts: Prompt[] = [];
        for (const up of this.upstreams) {
            try {
                if (!up.getServerCapabilities()?.prompts) {
                    logger.info({
                        sessionId: this.getId(),
                        namespace: up.getNamespace()
                    }, "upstream has no prompts capability");
                    continue;
                }
                const list = await up.listPrompts(
                    params,
                    this.resumptionObject(up.getNamespace(), RESUMABLES.LIST_PROMPTS, this.getId())
                );
                const arr = list?.prompts ?? [];
                logger.info({
                    sessionId: this.getId(),
                    namespace: up.getNamespace(),
                    count: arr.length,
                }, "fetched prompts from upstream");
                for (const p of arr) {
                    prompts.push({ ...p, name: `${up.getNamespace()}${this.seperator}${p.name}` });
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({ sessionId: this.getId(), namespace: up.getNamespace(), msg }, "failed to prompts/list upstream");
                return {
                    prompts: [],
                    isError: true,
                    error: [{ type: "text", text: msg }]
                };
            }
        }
        this.emit(SESSION_EVENTS.LIST_PROMPTS, prompts);
        return {
            prompts
        };
    }

    /** Get a namespaced prompt like "files/summarize" from the correct upstream. */
    async getPrompt(params: GetPromptRequest["params"]): Promise<GetPromptResult> {
        const startTime = Date.now();
        const { namespace, method } = this.extractNamespace(params.name);
        this.ensureConnected(namespace);
        const up = this.findByNamespace(namespace);

        // Check permissions
        if (!this.isPromptAllowed(up, method)) {
            logger.warn({
                sessionId: this.getId(),
                namespace,
                prompt: method
            }, 'Prompt access denied by permissions');
            return {
                messages: [],
                isError: true,
                error: [{ type: "text", text: `Permission denied: prompt '${method}' is not allowed for this MCP` }]
            };
        }

        try {
            const prompt = await up.getPrompt({
                name: method,
                arguments: params.arguments,
            });

            const durationMs = Date.now() - startTime;

            // Record metering event
            this.recordMeteringEvent(
                'prompt_get',
                up,
                method,
                params,
                prompt,
                durationMs
            );

            logger.info({ sessionId: this.getId(), namespace: namespace, method }, "prompts/get routed");
            this.emit(SESSION_EVENTS.GET_PROMPT, prompt);
            return prompt;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error({ sessionId: this.getId(), name: params.name, arguments: params.arguments, msg }, "failed to resources/list upstream");
            return {
                messages: [],
                isError: true,
                error: [{ type: "text", text: msg }]
            };
        }
    }


    /** Close all upstream transports and the SSEServerTransport. */
    async close(): Promise<void> {
        this.emit(SESSION_EVENTS.SHUTDOWN);

        // Stop idle monitoring
        this.stopIdleMonitoring();

        // Clear notification debounce timers
        for (const timer of this.notificationDebounce.values()) {
            clearTimeout(timer);
        }
        this.notificationDebounce.clear();

        // Remove event listeners from upstreams
        for (const [upstream, listeners] of this.upstreamListeners.entries()) {
            upstream.removeListener(UPSTREAM_EVENTS.TOOLS_LIST_CHANGED, listeners.toolsChanged);
            upstream.removeListener(UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED, listeners.resourcesChanged);
            upstream.removeListener(UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED, listeners.promptsChanged);
        }
        this.upstreamListeners.clear();

        try {
            await this.transport.close();
        } catch (e) {
            logger.warn({ sessionId: this.getId(), e }, "failed to close SSEServerTransport")
        }

        for (const up of this.upstreams) {
            try {
                // Only close if not stateless (stateless upstreams are shared)
                if (!up.isStateless()) {
                    await up.close();
                }
            } catch (e) {
                logger.warn({ sessionId: this.getId(), namespace: up.config.namespace, e }, "failed to close upstream transport")
            }
        }

        // Clear all references
        this.upstreams.length = 0;
        this.toolLookup.clear();
        this.resumptionTokens.clear();
    }
}
