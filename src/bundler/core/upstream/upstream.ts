import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { CallToolRequest, CallToolResult, ListToolsRequest, ListToolsResult, ListResourcesRequest, ListResourcesResult, ReadResourceRequest, ReadResourceResult, ListResourceTemplatesRequest, ListResourceTemplatesResult, ListPromptsRequest, ListPromptsResult, GetPromptRequest, GetPromptResult, ServerCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * Namespace Schema - Validates namespace identifiers for MCP compatibility
 *
 * Requirements derived from MCP Specification 2025-11-25:
 * - Tool names SHOULD be 1-128 characters
 * - Allowed characters: A-Z, a-z, 0-9, underscore, hyphen, dot
 * - Must be URL-safe (for resource URI query parameters)
 * - No consecutive underscores (reserved as separator `__`)
 *
 * Since namespaced tool names use format `namespace__toolname`, we limit
 * namespace to 64 chars to leave room for tool names within the 128 limit.
 */
export const NamespaceSchema = z
    .string()
    .min(1, "Namespace cannot be empty")
    .max(64, "Namespace must be 64 characters or less")
    .regex(
        /^(?!.*__)[A-Za-z0-9][A-Za-z0-9_.-]*$/,
        "Namespace must start with alphanumeric, contain only A-Z, a-z, 0-9, underscore, hyphen, dot, and no consecutive underscores"
    );

export type Namespace = z.infer<typeof NamespaceSchema>;

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

export type UpstreamEventType = typeof UPSTREAM_EVENTS[keyof typeof UPSTREAM_EVENTS];

/**
 * Event payload for upstream list change notifications.
 * Contains the namespace to identify which upstream changed.
 */
export interface UpstreamEventPayload {
    namespace: string;
    eventType: UpstreamEventType;
    params?: unknown;
}

/**
 * Upstream connector interface.
 * Implementations must extend EventEmitter and emit UPSTREAM_EVENTS.
 */
export interface IUpstreamConnector {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    reconnect(): Promise<void>;

    isConnected(): boolean;
    getNamespace(): string;
    getCapabilities(): ServerCapabilities | undefined;

    callTool(params: CallToolRequest["params"], options?: RequestOptions): Promise<CallToolResult>;
    listTools(params?: ListToolsRequest["params"], options?: RequestOptions): Promise<ListToolsResult>;
    listResources(params?: ListResourcesRequest["params"], options?: RequestOptions): Promise<ListResourcesResult>;
    readResource(params: ReadResourceRequest["params"], options?: RequestOptions): Promise<ReadResourceResult>;
    listResourceTemplates(params?: ListResourceTemplatesRequest["params"], options?: RequestOptions): Promise<ListResourceTemplatesResult>;
    listPrompts(params?: ListPromptsRequest["params"], options?: RequestOptions): Promise<ListPromptsResult>;
    getPrompt(params: GetPromptRequest["params"], options?: RequestOptions): Promise<GetPromptResult>;

    // EventEmitter methods for upstream events
    on(event: string, listener: (payload: UpstreamEventPayload) => void): this;
    removeListener(event: string, listener: (payload: UpstreamEventPayload) => void): this;
    removeAllListeners(event?: string): this;
}