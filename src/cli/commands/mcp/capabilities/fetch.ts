import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { Mcp } from "../../../utils/api-client.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { MCPAuthConfig } from "../../../../shared/domain/entities.js";
import { buildAuthOptions } from "../../../../bundler/core/upstream/upstream-auth.js";

type TransportType = "sse" | "streamable-http";

/**
 * Check if MCP can be queried (has auth available or doesn"t need it)
 */
export function canFetchMcp(mcp: Pick<Mcp, "authStrategy">, auth?: MCPAuthConfig): { canQuery: boolean; reason?: string } {
    if (!mcp.authStrategy || mcp.authStrategy === "NONE") {
        return { canQuery: true };
    }

    if (mcp.authStrategy === "MASTER" && auth) {
        return { canQuery: true };
    }

    if (mcp.authStrategy === "MASTER" && !auth) {
        throw new Error("Master auth required but not configured")
    }

    if (mcp.authStrategy === "USER_SET") {
        return { canQuery: false, reason: "Token-specific auth required (use with a bundle token)" };
    }

    return { canQuery: false, reason: "Unknown auth configuration" };
}


/**
 * Fetch capabilities using a specific transport type
 */
export async function fetchMcpCapabilities(
    mcp: Mcp,
    auth: MCPAuthConfig | undefined,
    transportType: TransportType = "streamable-http",
    timeoutMs: number = 3000
): Promise<{
    tools: Array<{ name: string; description?: string }>;
    resources: Array<{ name: string; uri: string; description?: string }>;
    prompts: Array<{ name: string; description?: string }>;
} | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const authOptions = buildAuthOptions(auth);
        const url = new URL(mcp.url);

        // StreamableHTTP requires Accept header with both application/json and text/event-stream
        if (transportType === "streamable-http") {
            authOptions.requestInit = authOptions.requestInit || {};
            authOptions.requestInit.headers = {
                ...authOptions.requestInit.headers,
                "Accept": "application/json, text/event-stream",
            };
        }

        // Create transport based on type
        const transport = transportType === "streamable-http"
            ? new StreamableHTTPClientTransport(url, authOptions)
            : new SSEClientTransport(url, authOptions);

        const client = new Client(
            {
                name: "mcpbundler-cli",
                version: "1.0.0",
            },
            {
                capabilities: {},
            }
        );

        try {
            await client.connect(transport, { signal: controller.signal });

            if (controller.signal.aborted) {
                throw new Error(`Timeout after ${timeoutMs}ms`);
            }

            const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
                client.listTools().catch(() => ({ tools: [] })),
                client.listResources().catch(() => ({ resources: [] })),
                client.listPrompts().catch(() => ({ prompts: [] })),
            ]);

            await client.close();

            return {
                tools: toolsResult.tools || [],
                resources: resourcesResult.resources || [],
                prompts: promptsResult.prompts || [],
            };
        } catch (error) {
            try {
                await client.close();
            } catch { }
            throw error;
        }
    } catch (error: any) {
        if (error.name === "AbortError" || controller.signal.aborted) {
            console.error(`Failed to fetch capabilities (${transportType}): Timeout after ${timeoutMs}ms`);
        } else {
            const errorMessage = error.response?.data?.error || error.message;
            // Only log error if we're not falling back
            if (transportType === "sse") {
                console.error(`Failed to fetch capabilities: ${errorMessage}`);
            }
        }
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}