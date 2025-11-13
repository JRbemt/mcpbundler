import logger from '../../../utils/logger.js';
import { BundlerAPIClient } from '../../utils/api-client.js';

interface ListOptions {
  host: string;
  token?: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  // Create HTTP API client
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    logger.debug({ serverUrl: options.host }, "Connecting to bundler server");
    // List all collections with their MCPs
    const collections = await client.listCollections();

    if (collections.length === 0) {
      logger.info('No collections found');
      logger.info('Start by adding an MCP: mcpbundler manage add <url>');
      return;
    }

    logger.info(`Found ${collections.length} collection(s):`);

    for (const collection of collections) {
      logger.info(`Collection: ${collection.name} (${collection.id})`);
      logger.info(`MCPs: ${collection.mcps.length}`);

      if (collection.mcps.length > 0) {
        collection.mcps.forEach((mcp: any) => {
          logger.info(` - ${mcp.namespace} (${mcp.url})`);
        });
      }
    }
  } catch (error: any) {
    logger.error({ error }, 'Failed to list MCPs:');
    process.exit(1);
  }
}
