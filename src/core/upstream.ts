/**
 * Upstream - Individual MCP server connection manager
 *
 * Manages a persistent SSE connection to a single upstream MCP server. Handles
 * connection lifecycle, automatic reconnection with exponential backoff, notification
 * subscriptions, and response caching. Each Upstream instance represents one MCP
 * server in a bundle.
 * 
 * stateless MCP's may share a connection
 * @see UpstreamPool
 */

import EventEmitter from "events";
import { MCPConfig } from "./config/schemas.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import logger from "../utils/logger.js";
import { z } from "zod";
import {
    Progress,
    Resource,
    CallToolRequest,
    CallToolResultSchema,
    CompatibilityCallToolResultSchema,
    ReadResourceResult,
    GetPromptResult,
    ListResourceTemplatesResult,
    ToolListChangedNotificationSchema,
    ResourceListChangedNotificationSchema,
    PromptListChangedNotificationSchema,
    ReadResourceRequest,
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
import { CacheManager } from "../utils/cacheable.js"
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { buildAuthOptions } from "./auth/mcp-auth.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pckg = JSON.parse(
    readFileSync(join(__dirname, "../../../package.json"), "utf-8")
);


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
 * Upstream manages connection to a single MCP server
 */
export class Upstream extends EventEmitter {

    readonly config: MCPConfig;
    private client: Client;
    private transport?: SSEClientTransport;

    public upstreamTimeout: number = 5000;

    private resumptionToken?: string;

    private connected: boolean = false;

    public retryMaxTime: number = 5000;
    private retryTimer?: NodeJS.Timeout;
    private retryAttempts = 0;

    // Cache infrastructure with LRU limits
    // NO chaching for now yet
    private tools = new CacheManager<ListToolsResult>({ max: 0 });
    private resources = new CacheManager<ListResourcesResult>({ max: 0 });
    private resourceTemplates = new CacheManager<ListResourceTemplatesResult>({ max: 0 });
    private prompts = new CacheManager<ListPromptsResult>({ max: 0 });


    constructor(config: MCPConfig) {
        super();
        this.config = config;
        logger.debug({
            namespace: config.namespace,
            authType: typeof config.auth,
            auth: config.auth
        }, "Upstream constructor received config");
        this.client = this.createClient();
    }

    private createClient(): Client {
        const client = new Client({
            name: "mcpbundler",
            version: pckg.version,
        }, {
            capabilities: {
            }
        });

        // Setup notification handlers for this client
        this.setupNotificationHandlersForClient(client);

        return client;
    }

    /**
     * Setup notification handlers for dynamic list changes
     *
     * Upstream servers can notify when their tools/resources/prompts change.
     * When notified, invalidate the corresponding cache and emit event.
     */
    private setupNotificationHandlersForClient(client: Client) {
        // Handle tools list changed notification
        client.setNotificationHandler(
            ToolListChangedNotificationSchema,
            async () => {
                logger.info({ namespace: this.getNamespace() },
                    "Upstream tools list changed");
                this.tools.invalidate();
                this.emit(UPSTREAM_EVENTS.TOOLS_LIST_CHANGED);
            }
        );

        // Handle resources list changed notification
        client.setNotificationHandler(
            ResourceListChangedNotificationSchema,
            async () => {
                logger.info({ namespace: this.getNamespace() },
                    "Upstream resources list changed");
                this.resources.invalidate();
                this.resourceTemplates.invalidate();
                this.emit(UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED);
            }
        );

        // Handle prompts list changed notification
        client.setNotificationHandler(
            PromptListChangedNotificationSchema,
            async () => {
                logger.info({ namespace: this.getNamespace() },
                    "Upstream prompts list changed");
                this.prompts.invalidate();
                this.emit(UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED);
            }
        );

    }

    /**
     * Connect to upstream MCP server
     *
     * Establishes SSE connection with authentication. Sets up transport event
     * handlers for disconnect/error. Returns true on success, false on failure.
     *
     * On reconnection, creates a fresh Client instance to avoid stale internal state.
     *
     * @returns Promise resolving to connection success status
     */
    public async connect(): Promise<boolean> {
        const isReconnect = this.client !== undefined;
        logger.info("CONNECTING")
        if (isReconnect) {
            logger.info({ namespace: this.getNamespace() }, "reconnecting: closing old client and creating fresh instance");

            // Close old client to clean up internal state
            try {
                await this.client.close();
            } catch (e) {
                logger.warn({ namespace: this.getNamespace() }, "error closing old client during reconnect (non-fatal)");
            }

            // Create fresh client instance to avoid stale state
            this.client = this.createClient();
        }

        // Build auth options from config
        const authOptions = buildAuthOptions(this.config.auth);

        logger.info({
            namespace: this.config.namespace,
            authOptions,
        }, "AUTH options")

        // Create transport with auth options (already in correct SSEClientTransportOptions format)
        const transport = new SSEClientTransport(
            new URL(this.getUrl()),
            authOptions
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
                    error: msg,
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
                authMethod: this.config.auth?.method || "none"
            }, "upstream successfully connected");
            this.emit(UPSTREAM_EVENTS.CONNECTED, this);
        } catch (e) {
            this.connected = false;
            logger.error({
                namespace: this.getNamespace(),
                url: this.getUrl(),
                authMethod: this.config.auth?.method || "none",
                error: e instanceof Error ? e.message : String(e)
            }, "failed to connect to upstream");

            this.emit(UPSTREAM_EVENTS.CONNECTION_FAILED, this);
            return false;
        }
        return true;
    }


    /**
     * Handle upstream disconnection
     *
     * Cleans up transport handlers, emits disconnect event, and schedules
     * reconnection with exponential backoff.
     */
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

    /**
     * Schedule reconnection with exponential backoff
     *
     * Uses exponential backoff capped at retryMaxTime (5000ms). Retries
     * indefinitely until connection succeeds or upstream is closed.
     */
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

    /**
     * Get server capabilities reported by upstream
     *
     * @returns Server capabilities or undefined if not connected
     */
    getServerCapabilities(): ServerCapabilities | undefined {
        return this.client.getServerCapabilities();
    }

    /**
     * List tools from upstream
     *
     * Caching currently disabled (max: 0). Future versions will cache responses.
     *
     * @param params Request parameters
     * @param options Request options
     * @returns List of available tools
     */
    async listTools(params?: ListToolsRequest["params"], options?: RequestOptions): Promise<ListToolsResult> {
        return await this.client.listTools(params, options);
    }

    /**
     * Call a tool on upstream
     *
     * Thin wrapper around SDK client. Session handles namespace extraction and metering.
     *
     * @param params Tool call parameters
     * @param resultSchema Result validation schema
     * @param options Request options
     * @returns Tool execution result
     */
    async callTool(
        params: CallToolRequest["params"],
        resultSchema: typeof CallToolResultSchema | typeof CompatibilityCallToolResultSchema = CallToolResultSchema,
        options?: RequestOptions
    ): Promise<z.infer<typeof resultSchema>> {
        return await this.client.callTool(params, resultSchema, options);
    }

    /**
     * List resources from upstream
     *
     * Caching currently disabled (max: 0). Future versions will cache responses.
     *
     * @param params Request parameters
     * @param options Request options
     * @returns List of available resources
     */
    async listResources(params?: ListResourcesRequest["params"], options?: RequestOptions): Promise<{ resources: Resource[] }> {
        return await this.client.listResources(params, options);
    }

    /**
     * Read a resource from upstream
     *
     * Thin wrapper around SDK client. Session handles namespace extraction and metering.
     *
     * @param params Resource read parameters
     * @param options Request options
     * @returns Resource contents
     */
    async readResource(
        params: ReadResourceRequest["params"],
        options?: RequestOptions
    ): Promise<ReadResourceResult> {
        return await this.client.readResource(params, options);
    }


    /**
     * List prompts from upstream
     *
     * Caching currently disabled (max: 0). Future versions will cache responses.
     *
     * @param params Request parameters
     * @param options Request options
     * @returns List of available prompts
     */
    async listPrompts(params?: ListPromptsRequest["params"], options?: RequestOptions): Promise<ListPromptsResult> {
        return await this.client.listPrompts(params, options);
    }

    /**
     * Get a prompt from upstream
     *
     * Thin wrapper around SDK client. Session handles namespace extraction and metering.
     *
     * @param params Prompt get parameters
     * @param options Request options
     * @returns Prompt details
     */
    async getPrompt(
        params: GetPromptRequest["params"],
        options?: RequestOptions
    ): Promise<GetPromptResult> {
        return await this.client.getPrompt(params, options);
    }

    /**
     * List resource templates from upstream
     *
     * Caching currently disabled (max: 0). Future versions will cache responses.
     *
     * @param params Request parameters
     * @param options Request options
     * @returns List of available resource templates
     */
    async listResourceTemplates(params?: ListResourceTemplatesRequest["params"], options?: RequestOptions): Promise<ListResourceTemplatesResult> {
        return await this.client.listResourceTemplates(params, options);
    }

    /**
     * Invalidate all caches
     *
     * Clears all cached list responses. Used on dynamic list change notifications
     * and during cleanup.
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

    /**
     * Close upstream connection
     *
     * Clears retry timers, transport handlers, caches, and closes the client.
     * Prevents reconnection attempts after shutdown.
     */
    public async close() {
        // Clear retry timer if exists
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = undefined;
        }

        // Clear transport event handlers to prevent reconnection attempts
        if (this.transport) {
            this.transport.onclose = undefined;
            this.transport.onerror = undefined;
        }

        this.invalidateAllCaches();
        this.emit(UPSTREAM_EVENTS.SHUTDOWN);
        await this.client.close();
    }
}

/**
 * UpstreamPool - Connection pooling for stateless MCPs
 *
 * Maintains singleton Upstream instances per namespace. Used for stateless MCPs
 * where multiple sessions can share the same connection. Lazy-initializes and
 * auto-connects upstreams on first access.
 */
export class UpstreamPool {

    private managers: Map<string, Upstream> = new Map();

    /**
     * Get or create upstream instance
     *
     * Returns existing upstream for namespace or creates new one. Auto-connects
     * on creation.
     *
     * @param config Upstream configuration
     * @returns Upstream instance for this namespace
     */
    public getOrCreate(config: MCPConfig): Upstream {
        let m = this.managers.get(config.namespace);
        if (!m) {
            m = new Upstream(config);
            this.managers.set(config.namespace, m);
            m.connect().catch((e) => {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error({
                    msg
                }, "unexpected error");
            });
        }
        return m;
    }
}