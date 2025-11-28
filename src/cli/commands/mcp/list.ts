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

    banner(" MCP Servers ", { bg: BG_COLORS.CYAN });
    console.group();

    if (mcps.length === 0) {
      console.log("(Currently no MCPs: mcpbundler mcp add)");
      console.groupEnd();
      return;
    }

    const tableData = mcps.map(mcp => ({
      Namespace: mcp.namespace,
      URL: mcp.url,
      Author: mcp.author,
      Version: mcp.version,
      Stateless: mcp.stateless ? "Yes" : "No",
      Auth: mcp.auth_strategy || "NONE",
      Created: new Date(mcp.created_at).toLocaleString(),
    }));

    console.table(tableData);
    console.groupEnd();
    console.log()
  } catch (error: any) {
    console.error(`Failed to list MCPs: ${error.message}`);
    process.exit(1);
  }
}
