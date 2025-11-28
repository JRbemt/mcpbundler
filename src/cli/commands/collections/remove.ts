import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface RemoveCollectionOptions {
  host: string;
  token: string;
}

/**
 * Remove a collection by name
 */
export async function removeCollectionCommand(name: string, options: RemoveCollectionOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    // Find collection by name
    const collections = await client.listCollections();
    const collection = collections.find(c => c.name === name);

    if (!collection) {
      console.error(`Collection "${name}" not found`);
      process.exit(1);
    }

    // Delete the collection
    await client.deleteCollection(collection.id);

    banner(" Collection Removed ", { bg: BG_COLORS.RED });

    const tableData = [{
      Name: collection.name,
      ID: collection.id,
      Status: "Deleted",
    }];

    console.table(tableData);
    console.log("\nCollection and all associated tokens have been permanently removed");
    console.log();

  } catch (error: any) {
    console.error(`Failed to remove collection: ${error.response?.data?.message || error.message}`);
    process.exit(1);
  }
}
