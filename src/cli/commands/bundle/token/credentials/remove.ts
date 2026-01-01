import { BundlerAPIClient } from "../../../../utils/api-client.js";

interface RemoveCredentialOptions {
    host: string;
}

/**
 * Remove credentials for a bundle token + MCP namespace
 */
export async function removeCredentialCommand(
    bundleToken: string,
    namespace: string,
    options: RemoveCredentialOptions
): Promise<void> {
    const client = new BundlerAPIClient(options.host);

    try {
        console.log(`Removing credentials for ${namespace}...`);
        await client.removeCredential(bundleToken, namespace);
        console.log(`Credentials removed successfully for ${namespace}`);
    } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.message;
        console.error(`Failed to remove credentials: ${errorMessage}`);
        process.exit(1);
    }
}
