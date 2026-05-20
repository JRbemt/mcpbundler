import { CallToolRequest, CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { AbstractBundlerMiddleware, BundlerMiddleware, MiddlewareContext } from "./middleware.js";
import logger from "../../../shared/utils/logger.js";

/**
 * A single first-party bundler tool definition.
 *
 * Register tools here to make them available to every downstream agent without
 * modifying session, bundler, or route code. The tool schema is injected into
 * every `tools/list` response; `handleOwnToolCall` dispatches calls by name.
 *
 * Example usage (future GEMMA context injection):
 *
 *   systemTools.registerTool({
 *     tool: {
 *       name: "bundler__set_context",
 *       description: "Tell the bundler your current task so it can select the most relevant MCPs.",
 *       inputSchema: {
 *         type: "object",
 *         properties: { task: { type: "string", description: "One-sentence task description" } },
 *         required: ["task"],
 *       },
 *     },
 *     handler: async (params, ctx) => {
 *       // Trigger LLM routing logic...
 *       return { content: [{ type: "text", text: "Context updated" }] };
 *     },
 *   });
 */
export interface BundlerToolDefinition {
    tool: Tool;
    handler: (
        params: CallToolRequest["params"],
        context: MiddlewareContext,
    ) => Promise<CallToolResult>;
}

/**
 * Canonical registry for all first-party bundler-native tools.
 *
 * Adding a new bundler tool only requires calling `registerTool` - no changes
 * to session, BundlerServer, or route code are needed.
 *
 * Tool names should follow the `bundler__<name>` convention to avoid collisions
 * with upstream MCP tool namespacing.
 */
export class BundlerSystemToolsMiddleware extends AbstractBundlerMiddleware {
    readonly name = "bundler-system-tools";

    private readonly registry: Map<string, BundlerToolDefinition> = new Map();

    registerTool(definition: BundlerToolDefinition): void {
        if (this.registry.has(definition.tool.name)) {
            throw new Error(`System tool "${definition.tool.name}" is already registered`);
        }
        this.registry.set(definition.tool.name, definition);
        logger.debug({ tool: definition.tool.name }, "System tool registered");
    }

    unregisterTool(toolName: string): boolean {
        const removed = this.registry.delete(toolName);
        if (removed) {
            logger.debug({ tool: toolName }, "System tool unregistered");
        }
        return removed;
    }

    getRegisteredToolNames(): string[] {
        return Array.from(this.registry.keys());
    }

    /**
     * Prepends all registered system tools to the tool list so they are
     * always visible to the agent regardless of which upstreams are attached.
     */
    async transformToolList(tools: Tool[], _ctx: MiddlewareContext): Promise<Tool[]> {
        const systemTools = Array.from(this.registry.values()).map((d) => d.tool);
        return [...systemTools, ...tools];
    }

    async handleOwnToolCall(
        params: CallToolRequest["params"],
        ctx: MiddlewareContext,
    ): Promise<CallToolResult | null> {
        const def = this.registry.get(params.name);
        if (!def) return null;

        logger.debug({ tool: params.name, sessionId: ctx.sessionId }, "Dispatching system tool call");
        try {
            return await def.handler(params, ctx);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ tool: params.name, sessionId: ctx.sessionId, err }, "System tool handler failed");
            return { content: [{ type: "text", text: `System tool error: ${msg}` }], isError: true };
        }
    }
}

/**
 * Re-export interface so consumers only need to import from this file.
 */
export type { BundlerMiddleware, MiddlewareContext };
