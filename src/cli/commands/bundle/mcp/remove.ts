import { BundlerAPIClient } from "../../../utils/api-client.js";

interface RemoveMcpOptions {
    host: string;
    token: string;
}

/**
 * Remove MCP(s) from a bundle by namespace
 */
export async function removeMcpFromBundleCommand(
    bundleId: string,
    namespaces: string[],
    options: RemoveMcpOptions
): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    let successCount = 0;
    let failCount = 0;

    console.log(`Removing ${namespaces.length} MCP(s) from bundle ${bundleId}...`);

    for (const namespace of namespaces) {
        try {
            await client.deleteMcpFromBundle(bundleId, namespace);
            console.log(`Removed ${namespace}`);
            successCount++;
        } catch (error: any) {
            const errorMessage = error.response?.data?.error || error.message;
            console.error(`Failed to remove ${namespace}: ${errorMessage}`);
            failCount++;
        }
    }

    console.log(`\nRemoved ${successCount}/${namespaces.length} MCP(s)`);

    if (failCount > 0) {
        process.exit(1);
    }
}
