import { BundlerAPIClient } from "../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../utils/print-utils.js";

interface GenerateSubscriptionTokenOptions {
  name?: string;
  description?: string;
  expires?: string;
  host: string;
  token?: string;
}

export async function generateSubscriptionTokenCommand(subscriptionName: string, options: GenerateSubscriptionTokenOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    const tokenName = options.name ?? subscriptionName;
    const result = await client.generateSubscriptionToken(
      subscriptionName,
      tokenName,
      options.description,
      options.expires
    );

    banner(" Token generated ");
    console.group();
    console.log(`Subscription: ${subscriptionName}`);
    console.log(`Token name:   ${result.tokenName}`);
    console.log();
    console.log(`Token: ${result.token}`);
    console.log();
    console.log(`Token ID:        ${result.tokenId}`);
    console.log(`Subscription ID: ${result.subscriptionId}`);
    console.log(`Bundle ID:       ${result.bundleId}`);
    console.log();
    console.log("Store this token securely - it will not be shown again.");
    console.groupEnd();
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.error(`Subscription "${subscriptionName}" not found.`);
      process.exit(1);
    }
    const msg = error.response?.data?.error || error.response?.data?.message || error.message;
    banner(" Token generation failed ", { bg: BG_COLORS.RED });
    console.log(msg);
    process.exit(1);
  }
}
