import { PrismaClient } from '@prisma/client';
import { CollectionResponse, UpstreamAuthConfig } from '../../config/schemas.js';
import { CollectionRepository, CollectionWithMcps } from '../../api/database/repositories/CollectionRepository.js';
import { AccessTokenRepository } from '../../api/database/repositories/AccessTokenRepository.js';
import { McpCredentialRepository } from '../../api/database/repositories/McpCredentialRepository.js';
import { createHash } from 'crypto';
import logger from '../../utils/logger.js';

/**
 * Interface for authentication services
 *
 * Simple, modular interface: resolve a collection token to its configuration
 */
export interface AuthService {
  /**
   * Resolve a collection token to its configuration
   *
   * @param token - Collection token (e.g., "mcpb_live_...")
   * @returns Collection configuration with upstreams
   * @throws Error if token is invalid, expired, or revoked
   */
  resolveCollection(token: string): Promise<CollectionResponse>;
}


/**
 * Database-backed authentication service
 * Resolves collection tokens to their MCP configurations with auth
 */
export class CollectionAuthService implements AuthService {
  private collectionRepo: CollectionRepository;
  private tokenRepo: AccessTokenRepository;
  private mcpCredRepo: McpCredentialRepository;
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.collectionRepo = new CollectionRepository(prisma);
    this.tokenRepo = new AccessTokenRepository(prisma);
    this.mcpCredRepo = new McpCredentialRepository(prisma);
  }

  async resolveCollection(token: string): Promise<CollectionResponse> {
    logger.debug('Resolving collection from token');

    // Find token record
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const tokenRecord = await this.tokenRepo.findByHash(tokenHash);

    if (!tokenRecord || !this.tokenRepo.isValid(tokenRecord)) {
      logger.warn('Invalid or expired token');
      const error: any = new Error('Invalid or expired token');
      error.status = 401;
      throw error;
    }

    // Load collection with MCPs
    const collection = await this.collectionRepo.findById(tokenRecord.collectionId);

    if (!collection) {
      logger.warn('Collection not found for valid token');
      const error: any = new Error('Collection not found');
      error.status = 404;
      throw error;
    }

    logger.info(
      {
        collectionId: collection.id,
        collectionName: collection.name,
        tokenId: tokenRecord.id,
        mcpCount: collection.collectionMcps.length,
      },
      'Successfully resolved collection from token'
    );

    // Resolve auth for each upstream based on authStrategy
    return await this.resolveUpstreamAuth(collection, tokenRecord.id);
  }

  /**
   * Resolve auth configurations for all upstreams based on their auth strategies
   */
  private async resolveUpstreamAuth(
    collection: CollectionWithMcps,
    tokenId: string
  ): Promise<CollectionResponse> {
    const upstreams = await Promise.all(
      collection.collectionMcps.map(async (collectionMcp) => {
        let auth: UpstreamAuthConfig | undefined;

        switch (collectionMcp.authStrategy) {
          case 'MASTER':
            // Use master auth config from Mcp if available
            if (collectionMcp.mcp.masterAuthConfig) {
              try {
                auth = JSON.parse(collectionMcp.mcp.masterAuthConfig);
              } catch (error) {
                logger.warn(
                  { mcpId: collectionMcp.mcpId, error },
                  'Failed to parse master auth config'
                );
              }
            }
            break;

          case 'TOKEN_SPECIFIC':
            // Look up token-specific credentials
            const credential = await this.mcpCredRepo.findByTokenAndMcp(
              tokenId,
              collectionMcp.mcpId
            );

            if (credential) {
              try {
                auth = JSON.parse(credential.authConfig);
              } catch (error) {
                logger.warn(
                  { mcpId: collectionMcp.mcpId, tokenId, error },
                  'Failed to parse token-specific auth config'
                );
              }
            } else {
              // Graceful failure: exclude this MCP from session
              logger.info(
                { mcpId: collectionMcp.mcpId, tokenId, namespace: collectionMcp.mcp.namespace },
                'Token-specific auth required but no credentials found - excluding MCP from session'
              );
              return null; // Signal to filter out this MCP
            }
            break;

          case 'NONE':
            // No authentication required
            auth = undefined;
            break;

          default:
            logger.warn(
              { authStrategy: collectionMcp.authStrategy },
              'Unknown auth strategy, defaulting to no auth'
            );
            auth = undefined;
        }

        return {
          namespace: collectionMcp.mcp.namespace,
          url: collectionMcp.mcp.url,
          author: collectionMcp.mcp.author,
          description: collectionMcp.mcp.description,
          version: collectionMcp.mcp.version,
          stateless: collectionMcp.mcp.stateless,
          auth_strategy: collectionMcp.authStrategy,
          auth,
          token_cost: collectionMcp.mcp.tokenCost,
          permissions: {
            allowed_tools: JSON.parse(collectionMcp.allowedTools),
            allowed_resources: JSON.parse(collectionMcp.allowedResources),
            allowed_prompts: JSON.parse(collectionMcp.allowedPrompts),
          },
        };
      })
    );

    // Filter out MCPs that returned null (missing TOKEN_SPECIFIC credentials)
    const availableUpstreams = upstreams.filter((u) => u !== null);

    return {
      collection_id: collection.id,
      user_id: 'system',
      name: collection.name,
      upstreams: availableUpstreams as any[],
    };
  }
}
