import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface ListSubscriptionsOptions {
  host: string;
  token?: string;
}

export async function listSubscriptionsCommand(options: ListSubscriptionsOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    const subs = await client.listSubscriptions();

    if (subs.length === 0) {
      console.log("No subscriptions found.");
      return;
    }

    banner(" Subscriptions ");
    for (const sub of subs) {
      console.log(`  ${sub.name}`);
      console.log(`    ID:          ${sub.id}`);
      console.log(`    Bundle:      ${sub.bundleId}`);
      console.log(`    Credentials: ${sub.hasCredentials ? "yes" : "none"}`);
      console.log(`    Router:      ${sub.hasRouter ? "yes" : "none"}`);
      console.log(`    Created:     ${new Date(sub.createdAt).toLocaleString()}`);
      console.log();
    }
  } catch (error: any) {
    const msg = error.response?.data?.error || error.response?.data?.message || error.message;
    banner(" Failed to list subscriptions ", { bg: BG_COLORS.RED });
    console.log(msg);
    process.exit(1);
  }
}
