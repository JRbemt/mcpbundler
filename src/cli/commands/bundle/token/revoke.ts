import { BundlerAPIClient } from "../../../utils/api-client.js";

interface TokenOptions {
    host: string;
    token?: string;
}

/**
 * Revoke a bundle token
 */
export async function revokeBundleTokenCommand(
    bundleId: string,
    tokenId: string,
    options: TokenOptions
): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        await client.revokeBundleToken(bundleId, tokenId);
        console.log(`Token ${tokenId} revoked successfully`);
    } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.message;
        console.error(`Failed to revoke token: ${errorMessage}`);
        process.exit(1);
    }
}
