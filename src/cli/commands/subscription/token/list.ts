import { BundlerAPIClient } from "../../../utils/api-client.js";
import { autoTable, banner, BG_COLORS } from "../../../utils/print-utils.js";

interface ListSubscriptionTokensOptions {
  host: string;
  token?: string;
}

export async function listSubscriptionTokensCommand(subscriptionName: string, options: ListSubscriptionTokensOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    const tokens = await client.listSubscriptionTokens(subscriptionName);

    banner(` Tokens for: ${subscriptionName} `);

    if (tokens.length === 0) {
      console.log("No tokens found for this subscription.");
      return;
    }

    const tableData = tokens.map(t => ({
      "Token ID": t.id,
      Name: t.name,
      Description: t.description || "-",
      Revoked: t.revoked ? "YES" : "NO",
      "Expires At": t.expiresAt ? new Date(t.expiresAt).toLocaleString() : "Never",
      "Created At": new Date(t.createdAt).toLocaleString(),
    }));

    autoTable(tableData);
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.error(`Subscription "${subscriptionName}" not found.`);
      process.exit(1);
    }
    const msg = error.response?.data?.error || error.response?.data?.message || error.message;
    banner(" Failed to list tokens ", { bg: BG_COLORS.RED });
    console.log(msg);
    process.exit(1);
  }
}
