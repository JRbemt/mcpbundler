import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UpstreamAuthConfig } from "../../../../core/config/schemas.js";
import { buildAuthOptions } from "../../../../utils/upstream-auth.js";
import { Mcp } from "../../../utils/api-client.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

/**
 * Check if MCP can be queried (has auth available or doesn"t need it)
 */
function canQueryMcp(mcp: Mcp): { canQuery: boolean; reason?: string } {
    if (!mcp.auth_strategy || mcp.auth_strategy === "NONE") {
        return { canQuery: true };
    }

    if (mcp.auth_strategy === "MASTER" && mcp.master_auth_config) {
        return { canQuery: true };
    }

    if (mcp.auth_strategy === "MASTER" && !mcp.master_auth_config) {
        return { canQuery: false, reason: "Master auth required but not configured" };
    }

    if (mcp.auth_strategy === "TOKEN_SPECIFIC") {
        return { canQuery: false, reason: "Token-specific auth required (use with a collection token)" };
    }

    return { canQuery: false, reason: "Unknown auth configuration" };
}

/**
 * Connect to MCP and fetch capabilities
 */
async function fetchMcpCapabilities(mcp: Mcp): Promise<{
    tools: Array<{ name: string; description?: string }>;
    resources: Array<{ name: string; uri: string; description?: string }>;
    prompts: Array<{ name: string; description?: string }>;
} | null> {
    try {
        // Parse auth config if available
        let authConfig: UpstreamAuthConfig | undefined;
        if (mcp.master_auth_config) {
            try {
                authConfig = JSON.parse(mcp.master_auth_config);
            } catch (error) {
                console.error(`Failed to parse auth config: ${error}`);
                return null;
            }
        }

        // Build transport options with auth
        const authOptions = buildAuthOptions(authConfig);
        const transportOptions: any = {};
        if (authOptions.headers) {
            transportOptions.headers = authOptions.headers;
        }
        if (authOptions.httpsAgent) {
            transportOptions.httpsAgent = authOptions.httpsAgent;
        }

        // Create client
        const transport = new SSEClientTransport(
            new URL(mcp.url),
            transportOptions
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

        // Connect with timeout
        await Promise.race([
            client.connect(transport),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Connection timeout")), 5000)
            ),
        ]);

        // Fetch capabilities
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
    } catch (error: any) {
        console.error(`Failed to fetch capabilities: ${error.message}`);
        return null;
    }
}