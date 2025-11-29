import { BundlerAPIClient } from "../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../utils/print-utils.js";

interface ShowOptions {
  token?: string;
  host: string;
}

export async function showCommand(username: string | undefined, options: ShowOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);

    if (username) {
      if (!options.token) {
        console.error("Error: Token required to view other users\" permissions");
        process.exit(1);
      }

      const result = await client.getUserPermissions(username);

      banner(`Permissions for ${result.user_name}`, { bg: BG_COLORS.CYAN });
      console.group()
      console.log(`Admin: ${result.is_admin}`);

      if (result.permissions.length > 0) {
        console.log(`Permissions (${result.permissions.length}):`);
        const tableData = result.permissions.map((perm, index) => ({
          "#": index + 1,
          Permission: perm.permission,
        }));
        console.table(tableData);
      } else {
        console.log("No permissions assigned.");
      }
      console.groupEnd()
      console.log()
    } else {
      if (!options.token) {
        console.error("Error: Token required");
        process.exit(1);
      }

      const result = await client.getOwnPermissions();

      banner(" Your Permissions ", { bg: BG_COLORS.CYAN });

      console.group()
      console.log(`Admin: ${result.is_admin}`);

      if (result.permissions.length > 0) {
        console.log(`Permissions (${result.permissions.length}):`);
        const tableData = result.permissions.map((perm, index) => ({
          "#": index + 1,
          Permission: perm,
        }));
        console.table(tableData);
      } else {
        console.log("No permissions assigned.");
      }
      console.groupEnd()
      console.log()
    }
  } catch (error: any) {
    console.error(`Error fetching permissions: ${error.response?.data?.error || error.message}`);
    process.exit(1);
  }
}
