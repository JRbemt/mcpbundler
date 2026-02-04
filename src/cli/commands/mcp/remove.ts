import { Mcp } from "../../../shared/domain/entities.js";
import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";
import * as readline from "readline";

interface RemoveOptions {
  all?: boolean;
  host: string;
  token?: string;
}

export async function removeMcpCommand(namespace: string | undefined, options: RemoveOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    // Validate: must have either namespace or --all, not both
    if (options.all && namespace) {
      console.error("Error: Cannot specify both namespace and --all flag");
      process.exit(1);
    }

    if (!options.all && !namespace) {
      console.error("Error: Must specify either a namespace or use --all flag");
      process.exit(1);
    }

    if (options.all) {
      // Mode 2: Remove all user's MCPs
      const confirmed = await confirmBulkDelete();
      if (!confirmed) {
        console.log("Operation cancelled");
        return;
      }

      const result = await client.deleteAllMyMcps();

      banner(" ALL MCP server(s) Removed ", { bg: BG_COLORS.RED });

      if (result.deleted === 0) {
        console.log("  No MCPs to delete");
      } else {
        console.log(`  Deleted ${result.deleted} MCP(s):`);
        result.mcps.map((ns: string) => {
          return {
            namespace: ns,
            status: "deleted"
          }
        })

      }
    } else {
      // Mode 1: Remove specific MCP by namespace
      await client.deleteMcp(namespace!);

      banner(" MCP server(s) Removed ", { bg: BG_COLORS.RED });
      console.group()
      const tableData = [{
        nNamespace: namespace,
        status: "deleted",
      }];

      console.table(tableData);
      console.log("MCP server has been permanently removed");
      console.groupEnd()
    }
  } catch (error: any) {
    console.error(`Failed to remove MCP: ${error.response?.data?.error || error.message}`);
    process.exit(1);
  }
}

async function confirmBulkDelete(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question("Are you sure you want to delete ALL your MCPs? (yes/no): ", (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "yes");
    });
  });
}
