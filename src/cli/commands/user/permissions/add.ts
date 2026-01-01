import { BundlerAPIClient } from "../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../utils/print-utils.js";

interface AddOptions {
  token: string;
  host: string;
  propagate?: boolean;
}

export async function addCommand(userId: string, permission: string[], options: AddOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const result = await client.addPermission(userId, permission, options.propagate);

    banner("Permission Added Successfully", { bg: BG_COLORS.GREEN });
    console.group()
    const tableData = [{
      User: result.name,
      Permission: result.permissions,
      "Affected Users": result.affectedUsers,
    }];

    console.table(tableData);

    if (options.propagate && result.affectedUsers > 1) {
      console.log(`Permission cascaded to ${result.affectedUsers} user(s) (including descendants)`);
    }
    console.groupEnd()
    console.log()
  } catch (error: any) {
    console.error(`Error adding permission: ${error.response?.data?.error || error.message}`);
    if (error.response?.data?.message) {
      console.error(`Details: ${error.response.data.message}`);
    }
    process.exit(1);
  }
}
