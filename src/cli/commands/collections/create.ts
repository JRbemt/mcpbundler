import logger from "../../../utils/logger.js";
import { BundlerAPIClient } from "../../utils/api-client.js";

interface CreateCollectionOptions {
    host: string;
    token?: string;
}

/**
 * Create a new collection
 */
export async function createCollectionCommand(name: string, options: CreateCollectionOptions): Promise<void> {
    // Create HTTP API client
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        const collection = await client.createCollection(name);
        logger.info({ id: collection.id, name: collection.name }, 'Collection created successfully');
    } catch (error: any) {
        logger.error('Failed to create collection:', error.message);
        process.exit(1);
    }
}
