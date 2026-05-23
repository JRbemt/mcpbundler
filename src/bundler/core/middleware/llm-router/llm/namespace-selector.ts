import logger from "../../../../../shared/utils/logger.js";
import { MCPConfig } from "../../../schemas.js";
import { LLMClient } from "./llm-client.js";
import { LLMRouterTool } from "../router-tool.js";

const SYSTEM_PROMPT_TEMPLATE = `You are a namespace routing assistant for an MCP (Model Context Protocol) bundler.
Your job is to select which MCP server namespaces contain tools needed for the given context.

Think about what operations the context requires, then match those to the servers listed below.

Available MCP servers:
{servers}

Instructions:
- Select at most {max} namespaces
- Only include namespaces with tools clearly relevant to the task or recent call pattern
- Use only namespace names from the list above
- Respond with ONLY a raw JSON object — no markdown, no code fences, no explanation
- Format: {"namespaces": ["ns1", "ns2"]}
- If nothing is relevant: {"namespaces": []}`;

const MAX_TOOLS_IN_PROMPT = 10;

function buildServerLine(u: MCPConfig, liveCatalog?: Map<string, string[]>): string {
    const parts: string[] = [`- ${u.namespace}`];

    if (u.description) {
        parts[0] += ` (${u.description})`;
    }

    const extras: string[] = [];

    if (u.capabilities?.length) {
        extras.push(`capabilities: ${u.capabilities.join(", ")}`);
    }

    // Prefer static tool list from config; fall back to names from live connection.
    const toolNames: string[] = u.tools?.length
        ? u.tools.map((t) => t.name)
        : (liveCatalog?.get(u.namespace) ?? []);

    if (toolNames.length) {
        const listed = toolNames.length > MAX_TOOLS_IN_PROMPT
            ? toolNames.slice(0, MAX_TOOLS_IN_PROMPT).join(", ") + ", ..."
            : toolNames.join(", ");
        extras.push(`tools: ${listed}`);
    }

    if (extras.length) {
        parts.push(`  [${extras.join("] [")}]`);
    }

    return parts.join("\n");
}

function buildSystemPrompt(available: MCPConfig[], max: number, liveCatalog?: Map<string, string[]>): string {
    const serverList = available
        .map((u) => buildServerLine(u, liveCatalog))
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

    // Final fallback: extract the namespaces array directly — handles truncated responses
    // where the array is complete but the outer object or closing fence is missing.
    const arrayMatch = raw.match(/"namespaces"\s*:\s*(\[[^\]]*\])/);
    if (arrayMatch) {
        const fromArray = tryParse(`{"namespaces":${arrayMatch[1]}}`);
        if (fromArray !== null) return fromArray;
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
        liveCatalog?: Map<string, string[]>,
    ): Promise<string[]> {
        if (availableUpstreams.length === 0) return [];

        const systemPrompt = buildSystemPrompt(availableUpstreams, maxUpstreams, liveCatalog);

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
