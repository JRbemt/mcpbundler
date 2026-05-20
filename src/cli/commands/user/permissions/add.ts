import { BundlerAPIClient } from "../../../utils/api-client.js";
import { autoTable, banner, BG_COLORS } from "../../../utils/print-utils.js";

interface AddOptions {
  token: string;
  host: string;
  propagate?: boolean;
}

export async function addCommand(userId: string, permission: string[], options: AddOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const result = await client.addPermission(userId, permission, options.propagate);

    banner(" Permission Added Successfully ", { bg: BG_COLORS.GREEN });
    autoTable([{
      User: result.name,
      Permission: String(result.permissions),
      "Affected Users": String(result.affectedUsers),
    }]);
    if (options.propagate && result.affectedUsers > 1) {
      console.log(`Permission cascaded to ${result.affectedUsers} user(s) (including descendants)`);
    }
    console.log()
  } catch (error: any) {
    console.error(`Error adding permission: ${error.response?.data?.error || error.message}`);
    if (error.response?.data?.message) {
      console.error(`Details: ${error.response.data.message}`);
    }
    process.exit(1);
  }
}
