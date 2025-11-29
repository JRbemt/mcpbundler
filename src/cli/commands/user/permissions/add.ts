import { BundlerAPIClient } from "../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../utils/print-utils.js";

interface AddOptions {
  token: string;
  host: string;
  propagate?: boolean;
}

export async function addCommand(username: string, permission: string, options: AddOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const result = await client.addPermission(username, permission, options.propagate);

    banner("Permission Added Successfully", { bg: BG_COLORS.GREEN });
    console.group()
    const tableData = [{
      User: result.user.name,
      Permission: result.permission,
      "Affected Users": result.affected_users,
    }];

    console.table(tableData);

    if (options.propagate && result.affected_users > 1) {
      console.log(`Permission cascaded to ${result.affected_users} user(s) (including descendants)`);
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
