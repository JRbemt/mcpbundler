import logger from "../../../utils/logger.js";
import { BundlerAPIClient } from "../../utils/api-client.js";

interface CollectionsOptions {
    host: string;
    token?: string;
}

/**
 * List all collections on the server
 */
export async function listCollectionsCommand(options: CollectionsOptions): Promise<void> {
    // Create HTTP API client (token is optional for listing collections)
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        const collections = await client.listCollections();

        if (collections.length === 0) {
            logger.info('No collections found');
            logger.info('\nCreate one with: mcpbundler manage collections create <name>');
            return;
        }

        logger.info(`Found ${collections.length} collection(s):\n`);

        for (const collection of collections) {
            logger.info(`📦 ${collection.name}`);
            logger.info(`   ID: ${collection.id}`);
            logger.info(`   MCPs: ${collection.mcps.length}`);
            logger.info(`   Created: ${new Date(collection.created_at).toLocaleString()}`);
            logger.info('');
        }
    } catch (error: any) {
        logger.error({ error }, 'Failed to list collections');
        process.exit(1);
    }
}