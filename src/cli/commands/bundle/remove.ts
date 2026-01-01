import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface RemoveBundleOptions {

  host: string;
  token: string;
}

/**
 * Remove a bundle by name
 */
export async function removeBundleCommand(id: string, options: RemoveBundleOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    await client.deleteBundle(id);

    banner(" Bundle Removed ", { bg: BG_COLORS.RED });

    const tableData = [{
      ID: id,
      Status: "Deleted",
    }];

    console.table(tableData);
    console.log("Bundle and all associated tokens have been permanently removed");
    console.log();

  } catch (error: any) {
    console.error(`Failed to remove bundle: ${error.response?.data?.message || error.message}`);
    process.exit(1);
  }
}
