import { banner, BG_COLORS } from "../utils/print-utils.js";
import { loadYamlConfig } from "../../bundler/core/resolver/yaml-config-loader.js";
import { BundlerAPIClient } from "../utils/api-client.js";

interface YamlTokenOptions {
  config: string;
  host: string;
  token?: string;
}

export async function yamlTokenCommand(subscriptionName: string, options: YamlTokenOptions): Promise<void> {
  try {
    const config = loadYamlConfig(options.config);

    const entry = config.subscriptions.find(s => s.name === subscriptionName);
    if (!entry) {
      const available = config.subscriptions.map(s => s.name).join(", ") || "(none)";
      console.error(`No subscribe entry found with name "${subscriptionName}".`);
      console.error(`Available subscription names: ${available}`);
      process.exit(1);
    }

    if (!options.token) {
      console.error("Management API token is required. Pass it with --token <mcpb_*>.");
      process.exit(1);
    }

    const client = new BundlerAPIClient(options.host, options.token);

    banner(" Token Generation ", { bg: BG_COLORS.YELLOW });
    console.log(`Subscription: ${subscriptionName}`);
    console.log(`Bundle:       ${entry.bundle}`);
    console.log(`Registry:     ${entry.registry}`);
    console.log();

    const result = await client.generateSubscriptionToken(
      subscriptionName,
      `${subscriptionName}-token`
    );

    console.log("Token generated. Copy it now - it will not be shown again.");
    console.log();
    console.log(`Token: ${result.token}`);
    console.log();
    console.log(`Token ID:        ${result.tokenId}`);
    console.log(`Subscription ID: ${result.subscriptionId}`);
    console.log(`Bundle ID:       ${result.bundleId}`);
  } catch (error: any) {
    const detail = error?.response?.data?.error ?? error.message;
    console.error(`Token generation failed: ${detail}`);
    process.exit(1);
  }
}
