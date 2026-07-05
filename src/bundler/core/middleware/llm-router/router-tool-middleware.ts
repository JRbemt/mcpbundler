import { Tool, CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AbstractBundlerMiddleware, MiddlewareContext } from "../middleware.js";
import { LLMRouterTool } from "./router-tool.js";
import { LLMRouterEngine } from "./router-engine.js";
import { LoadingStrategy } from "../../session/loading/loading-strategy.js";
import { InMemorySessionStateStore, SessionStateStore } from "../../session/session-state-store.js";
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
    /** Defaults to a private InMemorySessionStateStore when omitted (e.g. in tests). */
    store?: SessionStateStore;
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

    // Tool names per namespace observed from live connections (fallback when MCPConfig.tools is absent)
    private liveCatalog: Map<string, string[]> = new Map();

    // Signal 1 (callHistory, callsSinceLastRank) and the shared currentContext
    // are plain, connection-less decision-state, so they live in the
    // SessionStateStore rather than private fields - see session-state-store.ts.
    private readonly store: SessionStateStore;

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
        this.store = config.store ?? new InMemorySessionStateStore();
    }

    private buildLiveCatalog(tools: Tool[]): Map<string, string[]> {
        const catalog = new Map<string, string[]>();
        for (const tool of tools) {
            const sep = tool.name.indexOf("__");
            if (sep > 0) {
                const ns = tool.name.slice(0, sep);
                const toolName = tool.name.slice(sep + 2);
                const bucket = catalog.get(ns) ?? [];
                bucket.push(toolName);
                catalog.set(ns, bucket);
            }
        }
        return catalog;
    }

    async transformToolList(tools: Tool[], _ctx: MiddlewareContext): Promise<Tool[]> {
        this.liveCatalog = this.buildLiveCatalog(tools);

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
        let currentContext = (await this.store.get<string>(ctx.sessionId, "currentContext")) ?? "";
        if (typeof task === "string") {
            currentContext = task;
            await this.store.set(ctx.sessionId, "currentContext", currentContext);
        }

        if (ctx.loadingStrategy === LoadingStrategy.EAGER) {
            // Block until all selected upstreams are connected so tools are immediately
            // available when the agent processes this response.
            await this.triggerReRank(ctx, currentContext, this.setContextMaxActiveUpstreams);
            return {
                content: [{ type: "text", text: "Context updated. Tools are ready." }],
            };
        }

        // PROGRESSIVE: fire-and-forget; client receives list_changed notifications
        // as each selected upstream comes online.
        void this.triggerReRank(ctx, currentContext, this.setContextMaxActiveUpstreams);
        return {
            content: [{ type: "text", text: "Context updated. Activating relevant tools..." }],
        };
    }

    async onBeforeToolCall(
        params: CallToolRequest["params"],
        ctx: MiddlewareContext,
    ): Promise<void> {
        if (!this.rollingWindowEnabled) return;

        const callHistory = (await this.store.get<string[]>(ctx.sessionId, "callHistory")) ?? [];
        callHistory.push(params.name);
        if (callHistory.length > this.windowSize) {
            callHistory.shift();
        }
        await this.store.set(ctx.sessionId, "callHistory", callHistory);

        let callsSinceLastRank = ((await this.store.get<number>(ctx.sessionId, "callsSinceLastRank")) ?? 0) + 1;
        if (this.engine.isReady() && callsSinceLastRank >= this.reRankEveryNCalls) {
            callsSinceLastRank = 0;
            const context = "Recent calls: " + callHistory.join(", ");
            this.triggerReRank(ctx, context, this.rollingMaxActiveUpstreams);
        }
        await this.store.set(ctx.sessionId, "callsSinceLastRank", callsSinceLastRank);
    }

    async onUpstreamAttached(namespace: string, ctx: MiddlewareContext): Promise<void> {
        if (!this.engine.isReady()) return;
        logger.debug({ namespace }, "LLMToolRouter: upstream attached, re-ranking");
        const currentContext = await this.store.get<string>(ctx.sessionId, "currentContext");
        if (this.setContextEnabled && currentContext) {
            this.triggerReRank(ctx, currentContext, this.setContextMaxActiveUpstreams);
        }
    }

    private async triggerReRank(ctx: MiddlewareContext, context: string, maxActiveUpstreams: number): Promise<void> {
        try {
            const changed = await this.engine.reRank(ctx, context, maxActiveUpstreams, this.liveCatalog);
            if (changed) ctx.notifyToolsChanged();
        } catch (err) {
            logger.error({ err: err instanceof Error ? err.message : String(err) }, "LLMToolRouter reRank error");
        }
    }

    private extractNamespace(tool: Tool): string | null {
        const meta = (tool as any)._meta?.namespace;
        if (typeof meta === "string") return meta;
        const sep = tool.name.indexOf("__");
        if (sep > 0) return tool.name.slice(0, sep);
        return null;
    }
}
