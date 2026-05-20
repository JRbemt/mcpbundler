import { MCPConfig } from "../../schemas.js";

/**
 * Abstraction point for LLM-based MCP namespace selection.
 *
 * Implementations receive the current context string, the full catalog of
 * available upstreams, and a max-count budget, and return the namespaces
 * that are most relevant to the context.
 */
export interface LLMRouterTool {
    selectNamespaces(
        context: string,
        availableUpstreams: MCPConfig[],
        maxUpstreams: number,
    ): Promise<string[]>;
}

/**
 * Passthrough implementation - selects all available namespaces up to the max.
 * Used as the default model ("allpass") for development, testing, and when no
 * LLM backend is configured.
 */
export class AllPassToolRouterLLM implements LLMRouterTool {
    async selectNamespaces(
        _context: string,
        availableUpstreams: MCPConfig[],
        maxUpstreams: number,
    ): Promise<string[]> {
        return availableUpstreams.slice(0, maxUpstreams).map((u) => u.namespace);
    }
}

const LLM_REGISTRY: Map<string, LLMRouterTool> = new Map([
    ["allpass", new AllPassToolRouterLLM()],
]);

export function registerLLM(name: string, impl: LLMRouterTool): void {
    LLM_REGISTRY.set(name, impl);
}

export function getLLM(name: string): LLMRouterTool {
    return LLM_REGISTRY.get(name) ?? LLM_REGISTRY.get("allpass")!;
}

export function getRegisteredLLMNames(): string[] {
    return [...LLM_REGISTRY.keys()];
}
