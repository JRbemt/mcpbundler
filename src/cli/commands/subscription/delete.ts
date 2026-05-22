import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface DeleteSubscriptionOptions {
  host: string;
  token?: string;
}

export async function deleteSubscriptionCommand(name: string, options: DeleteSubscriptionOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    await client.deleteSubscription(name);
    console.log(`Subscription "${name}" deleted (all associated tokens revoked).`);
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.error(`Subscription "${name}" not found.`);
      process.exit(1);
    }
    const msg = error.response?.data?.error || error.response?.data?.message || error.message;
    banner(" Failed to delete subscription ", { bg: BG_COLORS.RED });
    console.log(msg);
    process.exit(1);
  }
}
