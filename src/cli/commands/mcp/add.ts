import logger from '../../../utils/logger.js';
import { BundlerAPIClient } from '../../utils/api-client.js';
import { readFileSync } from 'fs';
import { UpstreamAuthConfig } from '../../../config/schemas.js';

interface AddManualOptions {
  url: string;
  namespace: string;
  stateless: boolean;
  author: string;
  version: string;
  description?: string;
  descriptionFile?: string;
  authBearer?: string;
  authBasic?: string;
  authApikey?: string;
  host: string;
  token?: string;
}

/**
 * Add an MCP manually via URL and metadata
 */
export async function addManualCommand(options: AddManualOptions): Promise<void> {
  // TODO: everyone can add?
  const client = new BundlerAPIClient(options.host, options.token);

  try {
    logger.debug({ serverUrl: options.host }, "Connecting to bundler server");
    // Validate required fields
    if (!options.author) {
      logger.error('Error: --author is required when adding an MCP');
      throw new Error('Author is required');
    }

    // Get description from file or flag
    let description = options.description;
    if (options.descriptionFile) {
      try {
        description = readFileSync(options.descriptionFile, 'utf-8').trim();
      } catch (error: any) {
        logger.error(`Failed to read description file: ${error.message}`);
        throw new Error('Description file read error');
      }
    }

    if (!description) {
      logger.error('Error: Either --description or --description-file is required');
      throw new Error('Description or description file is required');
    }

    // Parse auth configuration
    let authConfig: UpstreamAuthConfig | undefined;
    const authOptionsCount = [
      options.authBearer,
      options.authBasic,
      options.authApikey
    ].filter(Boolean).length;

    if (authOptionsCount > 1) {
      logger.error('Error: Only one auth option can be specified at a time');
      throw new Error('Multiple auth options specified');
    }

    if (options.authBearer) {
      authConfig = {
        method: 'bearer',
        token: options.authBearer,
      };
    } else if (options.authBasic) {
      const [username, password] = options.authBasic.split(':');
      if (!username || !password) {
        logger.error('Error: --auth-basic must be in format "username:password"');
        throw new Error('--auth-basic must be in format "username:password"');
      }
      authConfig = {
        method: 'basic',
        username,
        password,
      };
    } else if (options.authApikey) {
      authConfig = {
        method: 'api_key',
        key: options.authApikey,
        header: 'X-API-Key',
      };
    }
    const namespace = options.namespace;
    if (!namespace) {
      logger.error('Error: --namespace is required when adding an MCP');
      throw new Error('Namespace is required');
    }

    // Build upstream config
    const upstreamConfig: any = {
      namespace,
      url: options.url,
      author: options.author,
      description,
      version: options.version,
      stateless: options.stateless ?? false,
    };

    // Add MCP to collection
    logger.info(`Adding MCP: ${upstreamConfig.namespace}`);
    logger.info(` - URL: ${upstreamConfig.url}`);
    logger.info(` - Author: ${upstreamConfig.author}`);
  } catch (error: any) {
    logger.error('Failed to add MCP:', error.message);
    throw error;
  }
}

interface AddOptions {
  host: string;
  token?: string;
}
/**
 * Add an MCP from a registry (not yet implemented)
 */
export async function addCommand(registryName: string, options: AddOptions): Promise<void> {
  logger.info('Registry support is not available yet. Work in progress.');
  logger.info('Please use a direct HTTP(S) URL instead.');
  logger.info('Example: mcpbundler manage add https://api.example.com/mcp --namespace files --author "Author Name" --description "MCP description"\n');
  throw new Error('Registry support not yet implemented');
}
