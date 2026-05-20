import { BundlerAPIClient } from "../../../utils/api-client.js";
import { autoTable, banner, BG_COLORS } from "../../../utils/print-utils.js";

interface RemoveOptions {
  token: string;
  host: string;
}

export async function removeCommand(userId: string, permission: string[], options: RemoveOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const result = await client.removePermission(userId, permission);

    banner(" Permission Removed ", { bg: BG_COLORS.RED });
    autoTable([{
      User: result.name,
      Permission: String(result.permissions),
      "Affected Users": String(result.affectedUsers),
    }]);
    if (result.affectedUsers > 1) {
      console.log(`Permission cascaded and removed from ${result.affectedUsers} user(s) (including descendants)`);
    }
    console.log()
  } catch (error: any) {
    console.error(`Error removing permission: ${error.response?.data?.error || error.message}`);
    if (error.response?.data?.message) {
      console.error(`Details: ${error.response.data.message}`);
    }
    process.exit(1);
  }
}
