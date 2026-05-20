import { BundlerAPIClient } from "../../utils/api-client.js";
import { autoTable, banner, BG_COLORS, confirm } from "../../utils/print-utils.js";

interface RemoveOptions {
  all?: boolean;
  host: string;
  token?: string;
}

export async function removeMcpCommand(namespace: string | undefined, options: RemoveOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    if (options.all && namespace) {
      console.error("Error: Cannot specify both namespace and --all flag");
      process.exit(1);
    }

    if (!options.all && !namespace) {
      console.error("Error: Must specify either a namespace or use --all flag");
      process.exit(1);
    }

    if (options.all) {
      const ok = await confirm("Are you sure you want to delete ALL your MCPs? This cannot be undone.");
      if (!ok) {
        console.log("Operation cancelled");
        return;
      }

      const result = await client.deleteAllMyMcps();

      banner(" ALL MCP server(s) Removed ", { bg: BG_COLORS.RED });

      if (result.deleted === 0) {
        console.log("  No MCPs to delete");
      } else {
        console.log(`  Deleted ${result.deleted} MCP(s):`);
        result.mcps.forEach((ns: string) => console.log(`    - ${ns}`));
      }
    } else {
      await client.deleteMcp(namespace!);

      banner(" MCP server(s) Removed ", { bg: BG_COLORS.RED });
      autoTable([{ Namespace: namespace, Status: "deleted" }]);
      console.log("MCP server has been permanently removed");
    }
  } catch (error: any) {
    console.error(`Failed to remove MCP: ${error.response?.data?.error || error.message}`);
    process.exit(1);
  }
}
