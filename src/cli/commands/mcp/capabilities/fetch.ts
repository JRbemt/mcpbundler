import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { MCPAuthConfig } from "../../../../core/config/schemas.js";

import { Mcp } from "../../../utils/api-client.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildAuthOptions } from "../../../../core/auth/mcp-auth.js";

/**
 * Check if MCP can be queried (has auth available or doesn"t need it)
 */
export function canFetchMcp(mcp: Mcp, auth: MCPAuthConfig | undefined): { canQuery: boolean; reason?: string } {
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
 * Connect to MCP and fetch capabilities
 */
export async function fetchMcpCapabilities(mcp: Mcp, auth: MCPAuthConfig | undefined): Promise<{
    tools: Array<{ name: string; description?: string }>;
    resources: Array<{ name: string; uri: string; description?: string }>;
    prompts: Array<{ name: string; description?: string }>;
} | null> {
    const TIMEOUT_MS = 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        // Build transport options with auth (already in correct SSEClientTransportOptions format)
        const authOptions = buildAuthOptions(auth);

        // Create client
        const transport = new SSEClientTransport(
            new URL(mcp.url),
            authOptions
        );

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

            // Fetch capabilities with timeout check
            if (controller.signal.aborted) {
                throw new Error(`Timeout after ${TIMEOUT_MS}ms`);
            }

            const [toolsResult, resourcesResult, promptsResult] = await Promise.all([
                client.listTools().catch(() => ({ tools: [] })),
                client.listResources().catch(() => ({ resources: [] })),
                client.listPrompts().catch(() => ({ prompts: [] })),
            ]);

            // Close connection
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
            console.error(`Failed to fetch capabilities: Timeout after ${TIMEOUT_MS}ms`);
        } else {
            const errorMessage = error.response?.data?.error || error.message;
            console.error(`Failed to fetch capabilities: ${errorMessage}`);
        }
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}