import EventEmitter from "events";
import { UpstreamConfig } from "../config/schemas.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import logger from "../utils/logger.js";
import { z } from "zod";
import {
    Progress,
    Tool,
    Resource,
    Prompt,
    ResourceTemplate,
    CallToolRequest,
    CallToolResult,
    CallToolResultSchema,
    CompatibilityCallToolResultSchema,
    ReadResourceResult,
    GetPromptResult,
    ListResourceTemplatesResult,
    ToolListChangedNotificationSchema,
    ResourceListChangedNotificationSchema,
    PromptListChangedNotificationSchema,
    ReadResourceRequest,
    ReadResourceResultSchema,
    ListPromptsRequest,
    ListPromptsResult,
    ListResourcesResult,
    ListToolsResult,
    GetPromptRequest,
    ListResourcesRequest,
    ListResourceTemplatesRequest,
    ServerCapabilities,
    ListToolsRequest
} from "@modelcontextprotocol/sdk/types.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { buildAuthOptions } from "../utils/upstream-auth.js";
import { cached, CacheManager } from "../utils/cacheable.js"

export const UPSTREAM_EVENTS = {
    CONNECTED: "connected",
    CONNECTION_FAILED: "connection_failed",
    DISCONNECTED: "disconnected",
    RECONNECTION_ATTEMPT: "reconnection_attempt",
    SHUTDOWN: "shutdown",
    TOOLS_LIST_CHANGED: "tools_list_changed",
    RESOURCES_LIST_CHANGED: "resources_list_changed",
    PROMPTS_LIST_CHANGED: "prompts_list_changed",
} as const;


/**
 * A manager responsible for connecting and maintaining a single upstream.
 */
export class Upstream extends EventEmitter {

    readonly config: UpstreamConfig;
    private readonly client: Client;
    private transport?: SSEClientTransport;

    public upstreamTimeout: number = 5000;

    private resumptionToken?: string;

    private connected: boolean = false;

    public retryMaxTime: number = 5000;
    private retryTimer?: NodeJS.Timeout;
    private retryAttempts = 0;

    // Cache infrastructure with LRU limits
    private tools = new CacheManager<ListToolsResult>();
    private resources = new CacheManager<ListResourcesResult>();
    private resourceTemplates = new CacheManager<ListResourceTemplatesResult>();
    private prompts = new CacheManager<ListPromptsResult>();


    constructor(config: UpstreamConfig) {
        super();
        this.config = config;
        this.client = new Client({
            name: config.namespace,
            version: config.version
        }, {
            capabilities: {

            }
        });

        // Setup notification handlers for dynamic list changes
        this.setupNotificationHandlers();
    }

    /**
     * Setup notification handlers for dynamic list changes
     * Upstream servers can notify when their tools/resources/prompts change
     */
    private setupNotificationHandlers() {
        // Handle tools list changed notification
        this.client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            async () => {
                logger.info({ namespace: this.getNamespace() },
                    'Upstream tools list changed');
                this.tools.invalidate();
                this.emit(UPSTREAM_EVENTS.TOOLS_LIST_CHANGED);
            }
        );

        // Handle resources list changed notification
        this.client.setNotificationHandler(
            ResourceListChangedNotificationSchema,
            async () => {
                logger.info({ namespace: this.getNamespace() },
                    'Upstream resources list changed');
                this.resources.invalidate();
                this.resourceTemplates.invalidate();
                this.emit(UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED);
            }
        );

        // Handle prompts list changed notification
        this.client.setNotificationHandler(
            PromptListChangedNotificationSchema,
            async () => {
                logger.info({ namespace: this.getNamespace() },
                    'Upstream prompts list changed');
                this.prompts.invalidate();
                this.emit(UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED);
            }
        );

    }

    public async connect(): Promise<boolean> {
        if (this.transport) {
            logger.info({ namespace: this.getNamespace() }, "reinit transport")
        }

        // Build auth options from config
        const authOptions = buildAuthOptions(this.config.auth);

        // Create transport with auth headers/agent
        const transportOptions: any = {};
        if (authOptions.headers) {
            transportOptions.headers = authOptions.headers;
        }
        if (authOptions.httpsAgent) {
            transportOptions.httpsAgent = authOptions.httpsAgent;
        }

        const transport = new SSEClientTransport(
            new URL(this.getUrl()),
            Object.keys(transportOptions).length > 0 ? transportOptions : undefined
        );
        this.transport = transport;

        try {
            // Added after #connect, handle disconnecting
            this.transport.onclose = async () => {
                logger.warn({ namespace: this.getNamespace() }, "onclose: upstream connection");
                await this.handleDisconnect();
            };

            this.transport.onerror = async (e: Error) => {
                const msg = e instanceof Error ? e.message : String(e);
                logger.warn({
                    namespace: this.getNamespace(),
                    url: this.getUrl(),
                    msg,
                }, "onerror: upstream connection");

                try {
                    // not all onerrors are fatal
                    await this.client.ping({ timeout: this.upstreamTimeout });
                    logger.info({ namespace: this.getNamespace() }, "onerror: was not fatal, ping succeeded")
                } catch (e) {
                    await this.handleDisconnect();
                }
            };

            // Throws error on fail
            await this.client.connect(
                this.transport,
                {
                    //TODO: test progress
                    onprogress: (progress: Progress) => {
                        logger.info({ namespace: this.getNamespace(), progress }, "progress")
                    },
                    resumptionToken: this.resumptionToken,
                    onresumptiontoken: (token: string) => {
                        this.resumptionToken = token;
                    },
                    timeout: this.upstreamTimeout
                }
            );
            this.connected = true;
            logger.info({
                namespace: this.getNamespace(),
                url: this.getUrl(),
                authMethod: this.config.auth?.method || 'none'
            }, "upstream successfully connected");
            this.emit(UPSTREAM_EVENTS.CONNECTED, this);
        } catch (e) {
            this.connected = false;
            logger.error({
                namespace: this.getNamespace(),
                url: this.getUrl(),
                authMethod: this.config.auth?.method || 'none'
            }, "failed to connect to upstream");

            this.emit(UPSTREAM_EVENTS.CONNECTION_FAILED, this);
            return false;
        }
        return true;
    }


    private async handleDisconnect() {
        if (this.transport) {
            this.transport!.onclose = undefined;
            this.transport!.onerror = undefined;
            await this.transport?.close();
        }
        this.connected = false;

        this.emit(UPSTREAM_EVENTS.DISCONNECTED, this);
        this.scheduleReconnect();
    }

    private scheduleReconnect() {
        if (this.retryTimer) return;
        const delay = Math.min(this.retryMaxTime, 1000 * 2 ** this.retryAttempts++);
        logger.info({ namespace: this.getNamespace() }, "scheduling reconnect")
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.connect().then((succes: boolean) => {
                if (succes) {
                    logger.info({
                        namespace: this.getNamespace()
                    }, "scheduled reconnect succeeded");

                    this.retryAttempts = 0;
                } else {
                    logger.info({
                        namespace: this.getNamespace()
                    }, "scheduled reconnect failed");

                    this.retryAttempts += 1;
                    this.scheduleReconnect();
                }
            }).catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({
                    msg
                }, "unexpected error");
                this.scheduleReconnect();
            })
        }, delay);

        this.emit(UPSTREAM_EVENTS.RECONNECTION_ATTEMPT, this, delay);
    }

    getServerCapabilities(): ServerCapabilities | undefined {
        return this.client.getServerCapabilities();
    }

    /**
     * List tools with caching
     * Returns cached tools if valid, otherwise fetches from upstream
     */
    @cached((instance: Upstream) => instance.tools, () => "")
    async listTools(params?: ListToolsRequest["params"], options?: RequestOptions): Promise<ListToolsResult> {
        logger.info("LISTING TOOLS")
        return await this.client.listTools(params, options);
    }

    /**
     * Call a tool on the upstream
     * Thin wrapper around client.callTool - session handles namespace extraction and metering
     */
    async callTool(
        params: CallToolRequest["params"],
        resultSchema: typeof CallToolResultSchema | typeof CompatibilityCallToolResultSchema = CallToolResultSchema,
        options?: RequestOptions
    ): Promise<z.infer<typeof resultSchema>> {
        return await this.client.callTool(params, resultSchema, options);
    }

    /**
     * List resources with caching
     * Returns cached resources if valid, otherwise fetches from upstream
     */
    @cached((instance: Upstream) => instance.resources, () => "")
    async listResources(params?: ListResourcesRequest["params"], options?: RequestOptions): Promise<{ resources: Resource[] }> {
        return await this.client.listResources(params, options);
    }

    /**
     * Read a resource on the upstream
     * Thin wrapper around client.readResource - session handles namespace extraction and metering
     */
    async readResource(
        params: ReadResourceRequest["params"],
        options?: RequestOptions
    ): Promise<ReadResourceResult> {
        return await this.client.readResource(params, options);
    }


    /**
     * List prompts with caching
     * Returns cached prompts if valid, otherwise fetches from upstream
     */
    @cached((instance: Upstream) => instance.prompts, () => "")
    async listPrompts(params?: ListPromptsRequest["params"], options?: RequestOptions): Promise<ListPromptsResult> {
        return await this.client.listPrompts(params, options);
    }

    /**
     * Read a resource on the upstream
     * Thin wrapper around client.readResource - session handles namespace extraction and metering
     */
    async getPrompt(
        params: GetPromptRequest["params"],
        options?: RequestOptions
    ): Promise<GetPromptResult> {
        return await this.client.getPrompt(params, options);
    }

    /**
     * List resourceTemplates with caching
     * Returns cached resourceTemplates if valid, otherwise fetches from upstream
     */
    @cached((instance: Upstream) => instance.resourceTemplates, () => "")
    async listResourceTemplates(params?: ListResourceTemplatesRequest["params"], options?: RequestOptions): Promise<ListResourceTemplatesResult> {
        return await this.client.listResourceTemplates(params, options);
    }

    /**
     * Invalidate all caches (useful for debugging/admin operations)
     */
    public invalidateAllCaches() {
        this.tools.invalidate();
        this.resources.invalidate();
        this.prompts.invalidate();
        this.resourceTemplates.invalidate();
    }

    public getTransport() {
        return this.transport;
    }

    public getNamespace() {
        return this.config.namespace;
    }

    public getUrl() {
        return this.config.url;
    }

    public isConnected() {
        return this.connected;
    }

    public isStateless() {
        return this.config.stateless;
    }

    public getClient() {
        return this.client;
    }

    public async close() {
        // Clear retry timer if exists
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }

        // Clear caches (helps with garbage collection)
        this.invalidateAllCaches();

        // Close the client
        await this.client.close();
    }
}
/**
 * A pool for obtaining instances of stateless MCP's
 */
export class UpstreamPool {

    private managers: Map<string, Upstream> = new Map();


    public getOrCreate(config: UpstreamConfig): Upstream {
        let m = this.managers.get(config.namespace);
        if (!m) {
            m = new Upstream(config);
            this.managers.set(config.namespace, m);
            m.connect().catch(() => { }); // fire-and-forget initial connect
        }
        return m;
    }
}