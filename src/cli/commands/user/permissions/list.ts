import { BundlerAPIClient } from "../../../utils/api-client.js";
import { autoTable, banner, BG_COLORS } from "../../../utils/print-utils.js";

interface ListOptions {
  host: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host);
    const result = await client.listPermissions();

    banner(" Available Permissions ", { bg: BG_COLORS.CYAN });
    autoTable(result.permissions.map((perm, index) => ({
      "#": String(index + 1),
      Permission: perm,
      Description: result.descriptions[perm] || "No description available",
    })));
    console.log();
  } catch (error: any) {
    console.error(`Error fetching permissions: ${error}`);
    process.exit(1);
  }
}
