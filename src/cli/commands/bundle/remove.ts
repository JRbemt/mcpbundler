import { BundlerAPIClient } from "../../utils/api-client.js";
import { autoTable, banner, BG_COLORS, confirm } from "../../utils/print-utils.js";

interface RemoveBundleOptions {
  host: string;
  token: string;
}

export async function removeBundleCommand(id: string, options: RemoveBundleOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    const ok = await confirm(`Remove bundle ${id} and all its tokens? This cannot be undone.`);
    if (!ok) {
      console.log("Operation cancelled");
      return;
    }

    await client.deleteBundle(id);

    banner(" Bundle Removed ", { bg: BG_COLORS.RED });
    autoTable([{ ID: id, Status: "Deleted" }]);
    console.log("Bundle and all associated tokens have been permanently removed");
    console.log();

  } catch (error: any) {
    console.error(`Failed to remove bundle: ${error.response?.data?.message || error.message}`);
    process.exit(1);
  }
}
