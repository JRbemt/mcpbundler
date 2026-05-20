import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS, confirm } from "../../utils/print-utils.js";

interface RevokeSelfOptions {
  token: string;
  host: string;
}

export async function revokeSelfCommand(options: RevokeSelfOptions): Promise<void> {
  try {
    const ok = await confirm("Revoke your own API key? This action is irreversible and you will lose access immediately.");
    if (!ok) {
      console.log("Operation cancelled");
      return;
    }

    const client = new BundlerAPIClient(options.host, options.token);
    await client.revokeOwnKey();

    banner(" API Key Revoked ", { bg: BG_COLORS.RED });
    console.group();
    console.log("Your API key is now invalid and cannot be used.");
    console.groupEnd();
    console.log();
  } catch (error: any) {
    console.error(`Error revoking key: ${error.response?.data?.error || error.message}`);
    process.exit(1);
  }
}
