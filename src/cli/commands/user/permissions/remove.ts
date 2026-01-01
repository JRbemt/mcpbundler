import { BundlerAPIClient } from "../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../utils/print-utils.js";

interface RemoveOptions {
  token: string;
  host: string;
}

export async function removeCommand(userId: string, permission: string[], options: RemoveOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const result = await client.removePermission(userId, permission);

    banner("Permission Removed", { bg: BG_COLORS.RED });
    console.group()
    const tableData = [{
      User: result.name,
      Permission: result.permissions,
      "Affected Users": result.affectedUsers,
    }];

    console.table(tableData);

    if (result.affectedUsers > 1) {
      console.log(`Permission cascaded and removed from ${result.affectedUsers} user(s) (including descendants)`);
    }
    console.groupEnd()
    console.log()
  } catch (error: any) {
    console.error(`Error removing permission: ${error.response?.data?.error || error.message}`);
    if (error.response?.data?.message) {
      console.error(`Details: ${error.response.data.message}`);
    }
    process.exit(1);
  }
}
