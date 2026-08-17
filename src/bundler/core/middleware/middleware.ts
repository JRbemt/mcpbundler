import {
    CallToolRequest,
    CallToolResult,
    Prompt,
    Resource,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { MCPConfig } from "../schemas.js";
import { LoadingStrategy } from "../session/loading/loading-strategy.js";

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
    readonly loadingStrategy: LoadingStrategy;
    readonly accessToken: string;

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
 *   Per tools/list     → transformToolList (inject own tools here)
 *   Per resources/list → transformResourceList
 *   Per prompts/list   → transformPromptList
 *   Per tools/call     → onBeforeToolCall (may short-circuit) → handleOwnToolCall → upstream → onAfterToolCall
 *   Per resources/read,
 *   Per prompts/get     → onBeforeToolCall (may short-circuit, synthetic name) → upstream
 *   Per upstream attach → onUpstreamAttached
 *   Removed from a live session, or session closed → teardown
 */
export interface BundlerMiddleware {
    readonly name: string;

    /**
     * Filter, reorder, or inject tools into the aggregated list before it is
     * returned to the downstream agent.
     */
    transformToolList(tools: Tool[], context: MiddlewareContext): Promise<Tool[]>;

    /**
     * Filter or reorder resources before the list is returned to the agent.
     */
    transformResourceList(resources: Resource[], context: MiddlewareContext): Promise<Resource[]>;

    /**
     * Filter or reorder prompts before the list is returned to the agent.
     */
    transformPromptList(prompts: Prompt[], context: MiddlewareContext): Promise<Prompt[]>;

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
     * Called before a tool call is dispatched at all - before both upstream
     * routing and `handleOwnToolCall`, and also before `readResource`/
     * `getPrompt` (using a synthetic `resource:${uri}`/`prompt:${name}`
     * params.name, since those calls have no CallToolRequest of their own).
     * Use for auditing, rate limiting, spend checks, or argument mutation -
     * anything that must run even for a middleware-owned tool, since a
     * middleware-owned call can have real cost (e.g. an LLM completion) and
     * is not automatically free just because it never reaches an upstream.
     * Returning a `CallToolResult` short-circuits the call: no request
     * reaches `handleOwnToolCall` or the upstream, and no later middleware's
     * `onBeforeToolCall` runs. Return nothing (undefined) to let the call
     * proceed to `handleOwnToolCall`/upstream routing.
     */
    onBeforeToolCall(
        params: CallToolRequest["params"],
        context: MiddlewareContext,
    ): Promise<CallToolResult | void>;

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

    async transformResourceList(resources: Resource[], _ctx: MiddlewareContext): Promise<Resource[]> {
        return resources;
    }

    async transformPromptList(prompts: Prompt[], _ctx: MiddlewareContext): Promise<Prompt[]> {
        return prompts;
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
    ): Promise<CallToolResult | void> { }

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
