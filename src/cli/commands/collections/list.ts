import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface CollectionsOptions {
    host: string;
    token?: string;
}

/**
 * List all collections on the server
 */
export async function listCollectionsCommand(options: CollectionsOptions): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        const collections = await client.listCollections();

        banner(" Collections ", { bg: BG_COLORS.CYAN });
        console.group();

        if (collections.length === 0) {
            console.log("(Currently no collections: mcpbundler collections create)");
            console.groupEnd();
            return;
        }

        const tableData = collections.map(collection => ({
            Name: collection.name,
            ID: collection.id,
            MCPs: collection.mcps.length,
            Created: new Date(collection.created_at).toLocaleString(),
        }));

        console.table(tableData);
        console.groupEnd();
        console.log();

    } catch (error: any) {
        console.error(`Failed to list collections: ${error.message}`);
        process.exit(1);
    }
}