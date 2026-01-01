import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface ListOptions {
  host: string;
  token: string;
}

export async function listMcpCommand(options: ListOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);
  try {
    const mcps = await client.listMcps();

    banner(" MCP Servers ", { bg: BG_COLORS.GREEN });
    console.group();

    if (mcps.length === 0) {
      console.log("(Currently no MCPs: mcpbundler mcp add)");
      console.groupEnd();
      return;
    }

    const tableData = mcps.map(mcp => ({
      Namespace: mcp.namespace,
      URL: mcp.url,
      Author: mcp.createdBy?.id || "Unknown",
      Version: mcp.version,
      Stateless: mcp.stateless ? "Yes" : "No",
      Auth: mcp.authStrategy || "NONE",
      Created: new Date(mcp.createdAt).toLocaleString(),
    }));

    console.table(tableData);
    console.groupEnd();
    console.log()
  } catch (error: any) {
    const errorMessage = error.response?.data?.error || error.message;
    console.error(`Failed to list MCPs: ${errorMessage}`);
    process.exit(1);
  }
}
