import { BundlerAPIClient } from "../../../utils/api-client.js";

interface AddMcpOptions {
    tools?: string[];
    resources?: string[];
    prompts?: string[];
    token: string;
    host: string;
}

/**
 * Add MCP(s) to a bundle by namespace
 */
export async function addMcpToBundleCommand(
    bundleId: string,
    namespaces: string[],
    options: AddMcpOptions
): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        // Build permissions from CLI options
        const permissions = {
            allowedTools: options.tools || ["*"],
            allowedResources: options.resources || ["*"],
            allowedPrompts: options.prompts || ["*"],
        };

        // Build request array
        const mcpRequests = namespaces.map(namespace => ({
            namespace,
            permissions,
        }));

        console.log(`Adding ${namespaces.length} MCP(s) to bundle ${bundleId}...`);
        const result = await client.addMcpToBundle(bundleId, mcpRequests);

        // Display results
        if (result.added.length > 0) {
            console.log(`Successfully added ${result.added.length} MCP(s):`);
            result.added.forEach(mcp => {
                console.log(`  - ${mcp.namespace} (${mcp.url})`);
            });
        }

        if (result.errors && result.errors.length > 0) {
            console.error(`Failed to add ${result.errors.length} MCP(s):`);
            result.errors.forEach(err => {
                console.error(`  - ${err.namespace}: ${err.reason}`);
            });

            if (result.added.length === 0) {
                process.exit(1);
            }
        }

        console.log();
    } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.message;
        console.error(`Failed to add MCP(s): ${errorMessage}`);
        process.exit(1);
    }
}
