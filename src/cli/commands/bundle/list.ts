import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface BundlesOptions {
    host: string;
    token?: string;
    me?: boolean;
}

/**
 * List all bundles on the server (or only user's bundles with --me flag)
 */
export async function listBundlesCommand(options: BundlesOptions): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        const bundles = options.me
            ? await client.listMyBundles()
            : await client.listBundles();

        const title = options.me ? " My Bundles " : " Bundles ";
        banner(title, { bg: BG_COLORS.CYAN });
        console.group();

        if (bundles.length === 0) {
            console.log("(Currently no bundles: mcpbundler bundles create)");
            console.groupEnd();
            return;
        }

        const tableData = bundles.map(bundle => ({
            Owner: bundle.createdBy?.name || "Unknown",
            OwnerID: bundle.createdBy?.id || "Unknown",
            Name: bundle.name,
            BundleID: bundle.id,
            MCPs: bundle.mcps?.length,
            Created: new Date(bundle.createdAt).toLocaleString(),
        }));

        console.table(tableData);
        console.groupEnd();
        console.log();

    } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.message;
        console.error(`Failed to list bundles: ${errorMessage}`);
        process.exit(1);
    }
}