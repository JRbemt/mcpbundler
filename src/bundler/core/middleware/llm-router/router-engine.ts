import { MCPConfig } from "../../schemas.js";
import { MiddlewareContext } from "../middleware.js";
import { LLMRouterTool } from "./router-tool.js";
import logger from "../../../../shared/utils/logger.js";

/**
 * Shared ranking state for the LLM tool router.
 *
 * Owns the namespace selection lifecycle: querying the LLM, attaching newly
 * selected upstreams, and tracking whether the visible set changed. Both
 * signals (rolling window and set_context) delegate to this engine so they
 * operate on the same selection state and never diverge.
 */
export class LLMRouterEngine {
    private selectedNamespaces: Set<string> = new Set();
    private isInitialized = false;

    constructor(private readonly llm: LLMRouterTool) { }

    isReady(): boolean {
        return this.isInitialized;
    }

    getSelectedNamespaces(): ReadonlySet<string> {
        return this.selectedNamespaces;
    }

    /**
     * Run a ranking pass against the LLM.
     *
     * Attaches any newly selected upstreams that are not yet connected,
     * updates the selected set, marks the engine as initialized, and
     * returns true when the visible namespace set changed (so callers can
     * decide whether to fire a list_changed notification).
     */
    async reRank(ctx: MiddlewareContext, context: string, maxActiveUpstreams: number): Promise<boolean> {
        if (!context) return false;

        const available = ctx.getAvailableUpstreams();

        let selected: string[];
        try {
            selected = await this.llm.selectNamespaces(context, available, maxActiveUpstreams);
        } catch (err) {
            // LLM call failed (network error, 4xx/5xx). Attach all available upstreams so
            // progressive-mode sessions can still discover tools, but keep isInitialized=false
            // so transformToolList stays in all-pass mode instead of filtering to nothing.
            logger.warn(
                { err: err instanceof Error ? err.message : String(err), context },
                "LLM namespace selection failed — keeping all-pass, attaching all upstreams"
            );
            const attachedSet = new Set(ctx.getAttachedNamespaces());
            for (const config of available.slice(0, maxActiveUpstreams)) {
                if (!attachedSet.has(config.namespace)) {
                    await ctx.attachUpstream(config).catch((e: Error) =>
                        logger.debug({ namespace: config.namespace, err: e.message }, "Upstream attach skipped during fallback")
                    );
                }
            }
            return false;
        }

        const attachedSet = new Set(ctx.getAttachedNamespaces());
        const availableByNs = new Map<string, MCPConfig>(available.map((u) => [u.namespace, u]));

        for (const ns of selected) {
            if (!attachedSet.has(ns)) {
                const config = availableByNs.get(ns);
                if (config) {
                    await ctx.attachUpstream(config);
                }
            }
        }

        const newSet = new Set(selected);
        const changed =
            newSet.size !== this.selectedNamespaces.size ||
            [...newSet].some((ns) => !this.selectedNamespaces.has(ns));

        this.selectedNamespaces = newSet;
        this.isInitialized = true;

        return changed;
    }
}
