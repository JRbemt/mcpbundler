
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
import { auditBundlerLog, AuditBundlerAction } from "../utils/audit-log.js";
import EventEmitter from "events";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { Upstream, UPSTREAM_EVENTS } from "./upstream.js";
import { PermissionManager } from "./components/PermissionManager.js";
import { NamespaceResolver, ToolNameHashMode } from "./components/NamespaceResolver.js";
import { SessionActivityMonitor } from "./components/SessionActivityMonitor.js";
import { UpstreamEventCoordinator } from "./components/UpstreamEventCoordinator.js";

// Re-export for backward compatibility
export { ToolNameHashMode } from "./components/NamespaceResolver.js";

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

    private resumptionTokens: Map<string, Map<Resumable, string>> = new Map()

    private errorOnListIfUpstreamDisconnected = true;
    private upstreamTimeout: number = 5000;

    private collectionId: string | null;
    private userId: string | null;

    // Permission management
    private permissionManager: PermissionManager;

    // Namespace resolution
    private namespaceResolver: NamespaceResolver;

    // Activity monitoring
    private activityMonitor: SessionActivityMonitor;

    // Upstream event coordination
    private eventCoordinator: UpstreamEventCoordinator;

    constructor(
        transport: SSEServerTransport,
        collectionId: string | null = null,
        userId: string | null = null,
        permissionManager: PermissionManager = new PermissionManager(),
        namespaceResolver: NamespaceResolver = new NamespaceResolver(),
        activityMonitor?: SessionActivityMonitor,
        eventCoordinator?: UpstreamEventCoordinator
    ) {
        super();
        this.id = transport.sessionId;
        this.transport = transport;
        this.upstreams = [];
        this.collectionId = collectionId;
        this.userId = userId;
        this.permissionManager = permissionManager;
        this.namespaceResolver = namespaceResolver;
        this.activityMonitor = activityMonitor || new SessionActivityMonitor(this.id);
        this.eventCoordinator = eventCoordinator || new UpstreamEventCoordinator(this.id);

        // Wire up activity tracking
        [
            SESSION_EVENTS.CALL_TOOL,
            SESSION_EVENTS.LIST_TOOLS,
            SESSION_EVENTS.LIST_RESOURCES,
            SESSION_EVENTS.READ_RESOURCE,
            SESSION_EVENTS.LIST_RESOURCE_TEMPLATES,
            SESSION_EVENTS.LIST_PROMPTS,
            SESSION_EVENTS.GET_PROMPT,
        ].forEach((e) => {
            this.on(e, () => this.activityMonitor.touch());
        });

        // Wire up idle timeout handler
        this.activityMonitor.on("idle_timeout", () => {
            this.close().catch(err => {
                logger.error({ sessionId: this.id, err }, "Error closing idle session");
            });
        });

        // Forward event coordinator notifications to session
        this.eventCoordinator.on("notify_tools_changed", (notification) => {
            this.emit("notify_tools_changed", notification);
            this.transport.send(notification).catch((err) => {
                logger.warn({ sessionId: this.id, err }, "Failed to send tools notification");
            });
        });
        this.eventCoordinator.on("notify_resources_changed", (notification) => {
            this.emit("notify_resources_changed", notification);
            this.transport.send(notification).catch((err) => {
                logger.warn({ sessionId: this.id, err }, "Failed to send resources notification");
            });
        });
        this.eventCoordinator.on("notify_prompts_changed", (notification) => {
            this.emit("notify_prompts_changed", notification);
            this.transport.send(notification).catch((err) => {
                logger.warn({ sessionId: this.id, err }, "Failed to send prompts notification");
            });
        });
    }


    public attach(upstream: Upstream) {
        this.upstreams.push(upstream);

        // Make sure every upstream has an entry
        this.resumptionTokens.set(upstream.getNamespace(), new Map<Resumable, string>())

        // Attach upstream to event coordinator for list change notifications
        this.eventCoordinator.attachUpstream(upstream);
    }

    public getId(): string {
        return this.id;
    }

    public touch(): this {
        this.activityMonitor.touch();
        return this;
    }

    public getTimeSinceLastActivity(): number {
        return this.activityMonitor.getTimeSinceLastActivity();
    }

    /**
     * Start idle timeout monitoring
     * Should be called after session is fully initialized
     */
    public startIdleMonitoring(): void {
        this.activityMonitor.startMonitoring();
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


    private findByNamespace(namespace: string): Upstream {
        const upstream = this.upstreams.find((u) => u.getNamespace() === namespace);
        if (!upstream) throw new Error(`Unknown tool namespace in "${namespace}", known: ${this.upstreams.map(u => u.getNamespace())}`);
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

                auditBundlerLog({
                    action: AuditBundlerAction.MCP_TOOLS_LIST,
                    sessionId: this.getId(),
                    success: true,
                    details: {
                        collectionId: this.collectionId,
                        namespace: up.getNamespace(),
                        host: up.getUrl(),
                        count: result?.tools?.length || 0,
                    },
                });

                if (!result?.tools?.length) {
                    logger.warn({
                        sessionId: this.getId(),
                        namespace: up.getNamespace()
                    }, "upstream returned no tools");
                    continue;
                }
                for (const t of result.tools) {
                    const namespacedTool = this.namespaceResolver.namespaceTool(up.getNamespace(), t);
                    tools.push(namespacedTool);
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);

                auditBundlerLog({
                    action: AuditBundlerAction.MCP_TOOLS_LIST,
                    sessionId: this.getId(),
                    success: false,
                    errorMessage: `Failed to list tools from upstream: ${msg}`,
                    details: {
                        collectionId: this.collectionId,
                        namespace: up.config.namespace,
                    },
                });
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
        try {
            let namespace: string, method: string;

            // First try to find in hash lookup table (for hashed tools)
            const lookup = this.namespaceResolver.lookupTool(params.name);
            if (lookup) {
                ({ namespace, method } = lookup);
            } else {
                // If not found in lookup, assume it"s a non-hashed namespaced tool
                ({ namespace, method } = this.namespaceResolver.extractNamespace(params.name));
            }
            this.ensureConnected(namespace);
            const up = this.findByNamespace(namespace);

            // Check permissions
            if (!this.permissionManager.isToolAllowed(up, method)) {
                this.permissionManager.logPermissionDenied(this.getId(), "tool", namespace, method);
                return {
                    content: [],
                    isError: true,
                    error: [{ type: "text", text: `Permission denied: tool "${method}" is not allowed for this MCP` }]
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

            auditBundlerLog({
                action: AuditBundlerAction.MCP_TOOL_CALL,
                sessionId: this.getId(),
                success: true,
                details: {
                    collectionId: this.collectionId,
                    namespace,
                    method,
                },
            });
            this.emit(SESSION_EVENTS.CALL_TOOL, method, params.arguments);
            return result as CallToolResult;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            auditBundlerLog({
                action: AuditBundlerAction.MCP_TOOL_CALL,
                sessionId: this.getId(),
                success: false,
                errorMessage: `Failed to call tool: ${msg}`,
                details: {
                    collectionId: this.collectionId,
                    method: params.name,
                },
            });
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
                auditBundlerLog({
                    action: AuditBundlerAction.MCP_RESOURCES_LIST,
                    sessionId: this.getId(),
                    success: true,
                    details: {
                        collectionId: this.collectionId,
                        namespace: up.getNamespace(),
                        count: arr.length,
                    },
                });

                for (const r of arr) {
                    // Keep everything, rewrite only the URI
                    resources.push({ ...r, uri: this.namespaceResolver.namespaceResource(up.getNamespace(), r.uri) });
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                auditBundlerLog({
                    action: AuditBundlerAction.MCP_RESOURCES_LIST,
                    sessionId: this.getId(),
                    success: false,
                    errorMessage: `Failed to list resources from upstream: ${msg}`,
                    details: {
                        collectionId: this.collectionId,
                        namespace: up.getNamespace(),
                    },
                });
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
        try {
            const { namespace, method } = this.namespaceResolver.extractNamespace(uri);
            this.ensureConnected(namespace);
            const up = this.findByNamespace(namespace);

            // Check permissions
            if (!this.permissionManager.isResourceAllowed(up, method)) {
                this.permissionManager.logPermissionDenied(this.getId(), "resource", namespace, method);
                return {
                    contents: [],
                    isError: true,
                    error: [{ type: "text", text: `Permission denied: resource "${method}" is not allowed for this MCP` }]
                };
            }

            // Pass-through other params like byte ranges if supplied
            const passthrough = { ...(params || {}), uri: method };
            const resource = await up.readResource(
                passthrough,
                this.resumptionObject(up.getNamespace(), RESUMABLES.READ_RESOURCE, this.getId())
            );

            auditBundlerLog({
                action: AuditBundlerAction.MCP_RESOURCE_READ,
                sessionId: this.getId(),
                success: true,
                details: {
                    collectionId: this.collectionId,
                    namespace: namespace,
                    uri: method,
                },
            });
            this.emit(SESSION_EVENTS.READ_RESOURCE, resource);
            return resource;

        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            auditBundlerLog({
                action: AuditBundlerAction.MCP_RESOURCE_READ,
                sessionId: this.getId(),
                success: false,
                errorMessage: `Failed to read resource: ${msg}`,
                details: {
                    collectionId: this.collectionId,
                    uri: params.uri,
                },
            });
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
                auditBundlerLog({
                    action: AuditBundlerAction.MCP_RESOURCE_TEMPLATES_LIST,
                    sessionId: this.getId(),
                    success: true,
                    details: {
                        collectionId: this.collectionId,
                        host: up.getUrl(),
                        namespace: up.getNamespace(),
                        count: arr.length,
                    },
                });

                for (const t of arr) {
                    // Keep everything, rewrite only the URI
                    resourceTemplates.push({
                        ...t,
                        uriTemplate: this.namespaceResolver.namespaceResourceTemplate(up.getNamespace(), t.uriTemplate)
                    });
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                auditBundlerLog({
                    action: AuditBundlerAction.MCP_RESOURCE_TEMPLATES_LIST,
                    sessionId: this.getId(),
                    success: false,
                    errorMessage: `Failed to list resource templates: ${msg}`,
                    details: {
                        collectionId: this.collectionId,
                        namespace: up.config.namespace,
                    },
                });
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
                auditBundlerLog({
                    action: AuditBundlerAction.MCP_PROMPTS_LIST,
                    sessionId: this.getId(),
                    success: true,
                    details: {
                        collectionId: this.collectionId,
                        namespace: up.getNamespace(),
                        count: arr.length,
                    },
                });
                for (const p of arr) {
                    prompts.push({ ...p, name: this.namespaceResolver.namespacePrompt(up.getNamespace(), p.name) });
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                auditBundlerLog({
                    action: AuditBundlerAction.MCP_PROMPTS_LIST,
                    sessionId: this.getId(),
                    success: false,
                    errorMessage: `Failed to list prompts: ${msg}`,
                    details: {
                        collectionId: this.collectionId,
                        namespace: up.getNamespace(),
                    },
                });
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
        const { namespace, method } = this.namespaceResolver.extractNamespace(params.name);
        this.ensureConnected(namespace);
        const up = this.findByNamespace(namespace);

        // Check permissions
        if (!this.permissionManager.isPromptAllowed(up, method)) {
            this.permissionManager.logPermissionDenied(this.getId(), "prompt", namespace, method);
            return {
                messages: [],
                isError: true,
                error: [{ type: "text", text: `Permission denied: prompt "${method}" is not allowed for this MCP` }]
            };
        }

        try {
            const prompt = await up.getPrompt({
                name: method,
                arguments: params.arguments,
            });

            auditBundlerLog({
                action: AuditBundlerAction.MCP_PROMPT_GET,
                sessionId: this.getId(),
                success: true,
                details: {
                    collectionId: this.collectionId,
                    namespace: namespace,
                    method,
                },
            });
            this.emit(SESSION_EVENTS.GET_PROMPT, prompt);
            return prompt;
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            auditBundlerLog({
                action: AuditBundlerAction.MCP_PROMPT_GET,
                sessionId: this.getId(),
                success: false,
                errorMessage: `Failed to get prompt: ${msg}`,
                details: {
                    collectionId: this.collectionId,
                    name: params.name,
                },
            });
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
        this.activityMonitor.stopMonitoring();

        // Detach all upstream event listeners
        this.eventCoordinator.detachAll();

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
        this.namespaceResolver.clearLookupTable();
        this.resumptionTokens.clear();
    }
}

