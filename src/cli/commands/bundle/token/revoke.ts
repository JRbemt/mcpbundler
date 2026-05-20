import { BundlerAPIClient } from "../../../utils/api-client.js";
import { confirm } from "../../../utils/print-utils.js";

interface TokenOptions {
  host: string;
  token?: string;
}

export async function revokeBundleTokenCommand(
  bundleId: string,
  tokenId: string,
  options: TokenOptions
): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    const ok = await confirm(`Revoke token ${tokenId}? Revoked tokens cannot be used to connect.`);
    if (!ok) {
      console.log("Operation cancelled");
      return;
    }

    await client.revokeBundleToken(bundleId, tokenId);
    console.log(`Token ${tokenId} revoked successfully`);
  } catch (error: any) {
    const errorMessage = error.response?.data?.error || error.message;
    console.error(`Failed to revoke token: ${errorMessage}`);
    process.exit(1);
  }
}
