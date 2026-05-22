import logger from "../../../../../shared/utils/logger.js";
import { MCPConfig } from "../../../schemas.js";
import { LLMClient } from "./llm-client.js";
import { LLMRouterTool } from "../router-tool.js";

const SYSTEM_PROMPT_TEMPLATE = `You are a tool routing assistant for an MCP (Model Context Protocol) bundler.
Your job is to select which MCP server namespaces are relevant to the user's current task.

Available MCP servers:
{servers}

Instructions:
- Select at most {max} namespaces
- Only include namespaces clearly relevant to the task
- Use only namespace names from the list above
- Return ONLY a valid JSON object in this exact shape: {"namespaces": ["ns1", "ns2"]}
- If nothing is relevant, return {"namespaces": []}`;

function buildSystemPrompt(available: MCPConfig[], max: number): string {
    const serverList = available
        .map((u) => {
            const desc = u.description ? `: ${u.description}` : "";
            return `- ${u.namespace}${desc}`;
        })
        .join("\n");

    return SYSTEM_PROMPT_TEMPLATE
        .replace("{servers}", serverList)
        .replace("{max}", String(max));
}

function parseNamespaces(raw: string, available: MCPConfig[]): string[] {
    const validSet = new Set(available.map((u) => u.namespace));

    const tryParse = (text: string): string[] | null => {
        try {
            const obj = JSON.parse(text);
            const arr = obj?.namespaces;
            if (!Array.isArray(arr)) return null;
            return arr.filter((ns): ns is string => typeof ns === "string" && validSet.has(ns));
        } catch {
            return null;
        }
    };

    // Direct parse
    const direct = tryParse(raw);
    if (direct !== null) return direct;

    // Strip markdown code fences and retry
    const stripped = raw.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
    const fromBlock = tryParse(stripped);
    if (fromBlock !== null) return fromBlock;

    // Last resort: find JSON object anywhere in the text
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
        const fromMatch = tryParse(match[0]);
        if (fromMatch !== null) return fromMatch;
    }

    logger.warn({ raw: raw.slice(0, 200) }, "LLM namespace selector: could not parse response");
    return [];
}

/**
 * ToolRouterLLM implementation backed by any LLMClient.
 *
 * Builds a namespace selection prompt from available MCPs and their descriptions,
 * calls the LLM, and parses the JSON response. Falls back to all available
 * namespaces (up to max) if the LLM call fails or produces an unparseable response,
 * so routing never silently deactivates all tools.
 */
export class LLMNamespaceSelector implements LLMRouterTool {
    constructor(private readonly client: LLMClient) { }

    async selectNamespaces(
        context: string,
        availableUpstreams: MCPConfig[],
        maxUpstreams: number,
    ): Promise<string[]> {
        if (availableUpstreams.length === 0) return [];

        const systemPrompt = buildSystemPrompt(availableUpstreams, maxUpstreams);

        // Throws on network / HTTP error — caller decides how to handle.
        const raw = await this.client.complete(systemPrompt, context);
        const selected = parseNamespaces(raw, availableUpstreams);

        if (selected.length === 0) {
            logger.warn({ context }, "LLM returned no valid namespaces — falling back to all-pass");
            return availableUpstreams.slice(0, maxUpstreams).map((u) => u.namespace);
        }

        logger.debug({ selected, context }, "LLM namespace selection complete");
        return selected;
    }
}
