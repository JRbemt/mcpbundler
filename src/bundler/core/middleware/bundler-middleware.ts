import {
    CallToolRequest,
    CallToolResult,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { MCPConfig } from "../schemas.js";

/**
 * Session control plane exposed to middleware.
 *
 * Middleware can observe and reshape the active bundle at runtime:
 * - Attach or detach upstream MCP servers (dynamic bundle composition)
 * - Trigger list-changed notifications to the downstream agent
 * - Inspect the full bundle catalog (attached and available upstreams)
 *
 * When `attachUpstream` is called the session's PROGRESSIVE loading path fires
 * `notifications/tools/list_changed` automatically; no additional plumbing is
 * required. `detachUpstream` requires an explicit `notifyToolsChanged()` call
 * because upstream removal does not auto-fire a notification.
 */
export interface MiddlewareContext {
    readonly sessionId: string;
    readonly bundleId: string;

    notifyToolsChanged(): void;
    notifyResourcesChanged(): void;
    notifyPromptsChanged(): void;

    attachUpstream(config: MCPConfig): Promise<void>;
    detachUpstream(namespace: string): void;
    getAttachedNamespaces(): string[];
    getAvailableUpstreams(): MCPConfig[];
}

/**
 * Middleware interface for the bundler's tool and call pipeline.
 *
 * Each method receives the full MiddlewareContext so middleware can
 * react to or reshape the active bundle at any point.
 *
 * Lifecycle:
 *   Session created → middleware added
 *   Per tools/list  → transformToolList (inject own tools here)
 *   Per tools/call  → handleOwnToolCall → onBeforeToolCall → upstream → onAfterToolCall
 *   Per upstream attach → onUpstreamAttached
 *   Session closed  → teardown
 */
export interface BundlerMiddleware {
    readonly name: string;

    /**
     * Filter, reorder, or inject tools into the aggregated list before it is
     * returned to the downstream agent. Middleware-owned tools (e.g. system
     * meta-tools) are injected here by appending to the array.
     */
    transformToolList(tools: Tool[], context: MiddlewareContext): Promise<Tool[]>;

    /**
     * Attempt to handle a tool call directly.
     * Return a `CallToolResult` to short-circuit upstream routing.
     * Return `null` to let the bundler route the call to the appropriate upstream.
     * This is the dispatch point for all middleware-owned tools.
     */
    handleOwnToolCall(
        params: CallToolRequest["params"],
        context: MiddlewareContext,
    ): Promise<CallToolResult | null>;

    /**
     * Called immediately before a tool call is forwarded to an upstream.
     * Use for auditing, rate limiting, or argument mutation.
     * Not called when `handleOwnToolCall` intercepts the call.
     */
    onBeforeToolCall(
        params: CallToolRequest["params"],
        context: MiddlewareContext,
    ): Promise<void>;

    /**
     * Called with the upstream result before it is returned to the agent.
     * May return a mutated result.
     * Not called when `handleOwnToolCall` intercepts the call.
     */
    onAfterToolCall(
        params: CallToolRequest["params"],
        result: CallToolResult,
        context: MiddlewareContext,
    ): Promise<CallToolResult>;

    /**
     * Called each time a new upstream finishes connecting to the session,
     * including dynamic attaches triggered by other middleware.
     */
    onUpstreamAttached(namespace: string, context: MiddlewareContext): Promise<void>;

    teardown(): Promise<void>;
}

/**
 * Default no-op base class. Extend this to implement only the hooks you need.
 */
export abstract class AbstractBundlerMiddleware implements BundlerMiddleware {
    abstract readonly name: string;

    async transformToolList(tools: Tool[], _ctx: MiddlewareContext): Promise<Tool[]> {
        return tools;
    }

    async handleOwnToolCall(
        _params: CallToolRequest["params"],
        _ctx: MiddlewareContext,
    ): Promise<CallToolResult | null> {
        return null;
    }

    async onBeforeToolCall(
        _params: CallToolRequest["params"],
        _ctx: MiddlewareContext,
    ): Promise<void> { }

    async onAfterToolCall(
        _params: CallToolRequest["params"],
        result: CallToolResult,
        _ctx: MiddlewareContext,
    ): Promise<CallToolResult> {
        return result;
    }

    async onUpstreamAttached(_namespace: string, _ctx: MiddlewareContext): Promise<void> { }

    async teardown(): Promise<void> { }
}
