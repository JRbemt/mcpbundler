import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface RevokeSelfOptions {
  token: string;
  host: string;
}

export async function revokeSelfCommand(options: RevokeSelfOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const result = await client.revokeOwnKey();

    banner("API Key Revoked", { bg: BG_COLORS.RED });

    console.log(`\n  Revoked at: ${new Date(result.revoked_at).toLocaleString()}`);
    console.log(`\n  ⚠️  Your API key is now invalid and cannot be used.`);
  } catch (error: any) {
    console.error(`Error revoking key: ${error.response?.data?.error || error.message}`);
    process.exit(1);
  }
}
