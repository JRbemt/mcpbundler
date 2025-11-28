import { BundlerAPIClient } from "../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../utils/print-utils.js";

interface ListOptions {
  host: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host);
    const result = await client.listPermissions();

    banner(" Available Permissions ", { bg: BG_COLORS.CYAN });
    console.group();

    const tableData = result.permissions.map((perm, index) => ({
      "#": index + 1,
      Permission: perm,
      Description: result.descriptions[perm] || "No description available",
    }));

    console.table(tableData);
    console.groupEnd();
    console.log();
  } catch (error: any) {
    console.error(`Error fetching permission types: ${error.response?.data?.error || error.message}`);
    process.exit(1);
  }
}
