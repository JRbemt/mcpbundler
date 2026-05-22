import { BundlerAPIClient } from "../../../utils/api-client.js";
import { confirm, banner, BG_COLORS } from "../../../utils/print-utils.js";

interface RevokeSubscriptionTokenOptions {
  host: string;
  token?: string;
}

export async function revokeSubscriptionTokenCommand(subscriptionName: string, tokenId: string, options: RevokeSubscriptionTokenOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    const ok = await confirm(`Revoke token ${tokenId}? Revoked tokens cannot be used to connect.`);
    if (!ok) {
      console.log("Operation cancelled.");
      return;
    }

    await client.revokeSubscriptionToken(subscriptionName, tokenId);
    console.log(`Token ${tokenId} revoked successfully.`);
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.error(`Subscription "${subscriptionName}" or token "${tokenId}" not found.`);
      process.exit(1);
    }
    const msg = error.response?.data?.error || error.response?.data?.message || error.message;
    banner(" Failed to revoke token ", { bg: BG_COLORS.RED });
    console.log(msg);
    process.exit(1);
  }
}
