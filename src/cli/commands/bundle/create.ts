import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface CreateBundleOptions {
    host: string;
    token?: string;
}

/**
 * Create a new bundle
 */
export async function createBundleCommand(name: string, description: string, options: CreateBundleOptions): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        const bundle = await client.createBundle(name, description);

        banner(" Bundle Created Successfully ", { bg: BG_COLORS.GREEN });

        console.group();
        const tableData = [{
            ID: bundle.id,
            Name: bundle.name,
            Description: bundle.description,
            Creator: bundle.createdBy?.name || "N/A",
            Created: new Date(bundle.createdAt).toLocaleString(),
        }];

        console.table(tableData);
        console.log();
        console.groupEnd();
        process.exit(0);
    } catch (error: any) {
        const errorMsg = error.response?.data?.error || error.message;

        banner(" Failed to Create Bundle ", { bg: BG_COLORS.RED });

        console.group();
        console.error(`Error: ${errorMsg}`);
        console.log();
        console.groupEnd();

        process.exit(1);
    }
}
