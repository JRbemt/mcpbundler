import { Tool, CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AbstractBundlerMiddleware, MiddlewareContext } from "../middleware.js";
import { LLMRouterTool } from "./router-tool.js";
import { LLMRouterEngine } from "./router-engine.js";
import logger from "../../../../shared/utils/logger.js";

export interface LLMToolRouterConfig {
    llm: LLMRouterTool;
    rollingWindow?: {
        enabled: boolean;
        maxActiveUpstreams?: number;
        windowSize?: number;
        reRankEveryNCalls?: number;
    };
    setContext?: {
        enabled: boolean;
        maxActiveUpstreams?: number;
        toolName?: string;
    };
}

const SET_CONTEXT_TOOL_DESCRIPTION =
    "Declare your current task goal so the bundler can activate the most relevant MCP tools. " +
    "Call this at the start of each new task with a one-sentence description of what you are trying to accomplish.";

export class LLMToolRouterMiddleware extends AbstractBundlerMiddleware {
    readonly name = "llm-tool-router";

    // Shared ranking engine - both signals read and write the same selection state.
    private readonly engine: LLMRouterEngine;

    // Signal 1: LLM passive ranking
    private readonly rollingWindowEnabled: boolean;
    private readonly rollingMaxActiveUpstreams: number;
    private readonly windowSize: number;
    private readonly reRankEveryNCalls: number;

    // Signal 2: LLM active ranking set_context tool 
    private readonly setContextEnabled: boolean;
    private readonly setContextMaxActiveUpstreams: number;
    private readonly setContextToolName: string;

    // Signal 1 state (local to this signal)
    private callHistory: string[] = [];
    private callsSinceLastRank = 0;

    // Shared across signals - the last declared task context
    private currentContext = "";

    constructor(config: LLMToolRouterConfig) {
        super();
        this.engine = new LLMRouterEngine(config.llm);
        this.rollingWindowEnabled = config.rollingWindow?.enabled ?? false;
        this.rollingMaxActiveUpstreams = config.rollingWindow?.maxActiveUpstreams ?? 10;
        this.windowSize = config.rollingWindow?.windowSize ?? 10;
        this.reRankEveryNCalls = config.rollingWindow?.reRankEveryNCalls ?? 5;
        this.setContextEnabled = config.setContext?.enabled ?? false;
        this.setContextMaxActiveUpstreams = config.setContext?.maxActiveUpstreams ?? 10;
        this.setContextToolName = config.setContext?.toolName ?? "bundler__set_context";
    }

    async transformToolList(tools: Tool[], _ctx: MiddlewareContext): Promise<Tool[]> {
        const result: Tool[] = [];

        if (this.setContextEnabled) {
            result.push({
                name: this.setContextToolName,
                description: SET_CONTEXT_TOOL_DESCRIPTION,
                inputSchema: {
                    type: "object" as const,
                    properties: {
                        task: {
                            type: "string",
                            description: "One-sentence description of your current task goal.",
                        },
                    },
                    required: ["task"],
                },
            });
        }

        if (!this.engine.isReady()) {
            result.push(...tools);
            return result;
        }

        const selected = this.engine.getSelectedNamespaces();
        for (const tool of tools) {
            const ns = this.extractNamespace(tool);
            if (ns && selected.has(ns)) {
                result.push(tool);
            }
        }

        return result;
    }

    async handleOwnToolCall(
        params: CallToolRequest["params"],
        ctx: MiddlewareContext,
    ): Promise<CallToolResult | null> {
        if (!this.setContextEnabled || params.name !== this.setContextToolName) {
            return null;
        }

        const task = (params.arguments as Record<string, unknown>)?.task;
        if (typeof task === "string") {
            this.currentContext = task;
        }

        this.triggerReRank(ctx, this.currentContext, this.setContextMaxActiveUpstreams);

        return {
            content: [{ type: "text", text: "Context updated. Activating relevant tools..." }],
        };
    }

    async onBeforeToolCall(
        params: CallToolRequest["params"],
        ctx: MiddlewareContext,
    ): Promise<void> {
        if (!this.rollingWindowEnabled) return;

        this.callHistory.push(params.name);
        if (this.callHistory.length > this.windowSize) {
            this.callHistory.shift();
        }

        this.callsSinceLastRank++;
        if (this.engine.isReady() && this.callsSinceLastRank >= this.reRankEveryNCalls) {
            this.callsSinceLastRank = 0;
            const context = "Recent calls: " + this.callHistory.join(", ");
            this.triggerReRank(ctx, context, this.rollingMaxActiveUpstreams);
        }
    }

    async onUpstreamAttached(namespace: string, ctx: MiddlewareContext): Promise<void> {
        if (!this.engine.isReady()) return;
        logger.debug({ namespace }, "LLMToolRouter: upstream attached, re-ranking");
        if (this.setContextEnabled && this.currentContext) {
            this.triggerReRank(ctx, this.currentContext, this.setContextMaxActiveUpstreams);
        }
    }

    private triggerReRank(ctx: MiddlewareContext, context: string, maxActiveUpstreams: number): void {
        this.engine.reRank(ctx, context, maxActiveUpstreams)
            .then((changed) => { if (changed) ctx.notifyToolsChanged(); })
            .catch((err: Error) => logger.error({ err: err.message }, "LLMToolRouter reRank error"));
    }

    private extractNamespace(tool: Tool): string | null {
        const meta = (tool as any)._meta?.namespace;
        if (typeof meta === "string") return meta;
        const sep = tool.name.indexOf("__");
        if (sep > 0) return tool.name.slice(0, sep);
        return null;
    }
}
