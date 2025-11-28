import logger from "../../../utils/logger.js";
import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface RemoveOptions {
  host: string;
  token?: string;
}

export async function removeMcpCommand(namespace: string, options: RemoveOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    logger.debug({ serverUrl: options.host }, "Connecting to bundler server");

    await client.deleteMcp(namespace);

    banner("MCP Server Removed", { bg: BG_COLORS.RED });

    const tableData = [{
      Namespace: namespace,
      Status: "Deleted",
    }];

    console.table(tableData);

    console.log("\n  ⚠️  MCP server has been permanently removed");
  } catch (error: any) {
    console.error(`Failed to remove MCP: ${error.message}`);
    process.exit(1);
  }
}
