import logger from "../../../utils/logger.js";
import { BundlerAPIClient } from "../../utils/api-client.js";

interface GetTokenOptions {
    host: string;
    token?: string;
}

/**
 * Generate access token for a collection
 */
export async function getTokenCommand(collectionId: string, options: GetTokenOptions): Promise<void> {
    // Create HTTP API client
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        logger.info(`Generating access token for collection: ${collectionId}`);
        const result = await client.generateToken(collectionId);

        logger.info('Token generated successfully\n');
        logger.info('Access Token:');
        logger.info(`  ${result.token}\n`);
        logger.info('Store this token securely! It will not be shown again.\n');
        logger.info('Use this token to:');
        logger.info('  1. Connect via STDIO client:');
        logger.info(`     mcpbundler client connect --host <server-url> --token ${result.token}`);
        logger.info('  2. Connect via SSE with Authorization header:');
        logger.info(`     Authorization: Bearer ${result.token}`);
    } catch (error: any) {
        logger.error('Failed to generate token:', error.message);
        process.exit(1);
    }
}
