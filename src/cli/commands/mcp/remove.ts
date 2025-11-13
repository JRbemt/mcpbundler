import logger from '../../../utils/logger.js';
import { BundlerAPIClient } from '../../utils/api-client.js';

interface RemoveOptions {
  host: string;
  token?: string;
}

export async function removeCommand(namespace: string, options: RemoveOptions): Promise<void> {
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    logger.debug({ serverUrl: options.host }, "Connecting to bundler server");

    await client.deleteMcp(namespace)

    logger.info('MCP removed successfully');
  } catch (error: any) {
    logger.error('Failed to remove MCP:', error.message);
    process.exit(1);
  }
}
