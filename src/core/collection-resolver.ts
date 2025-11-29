import { PrismaClient } from '@prisma/client';
import { CollectionResponse, UpstreamAuthConfig } from './config/schemas.js';
import { CollectionRepository, CollectionWithMcps } from '../api/database/repositories/CollectionRepository.js';
import { AccessTokenRepository } from '../api/database/repositories/AccessTokenRepository.js';
import { McpCredentialRepository } from '../api/database/repositories/McpCredentialRepository.js';
import { McpRepository } from '../api/database/repositories/McpRepository.js';
import { createHash } from 'crypto';
import logger from '../utils/logger.js';

/**
 * Wildcard authentication configuration,
 * allowing a special token to access all MCPs (that have auth set to MASTER or NONE)
 */
export interface WildcardAuthConfig {
  allow_wildcard_token: boolean;
  wildcard_token?: string;
}

/**
 * Interface for resloving collection configurations
 * 
 */
export interface ResolverService {
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
export class CollectionResolver implements ResolverService {
  private collectionRepo: CollectionRepository;
  private tokenRepo: AccessTokenRepository;
  private mcpCredRepo: McpCredentialRepository;
  private mcpRepo: McpRepository;
  private prisma: PrismaClient;
  private wildcardAuth?: WildcardAuthConfig;

  constructor(prisma: PrismaClient, wildcardAuth?: WildcardAuthConfig) {
    this.prisma = prisma;
    this.collectionRepo = new CollectionRepository(prisma);
    this.tokenRepo = new AccessTokenRepository(prisma);
    this.mcpCredRepo = new McpCredentialRepository(prisma);
    this.mcpRepo = new McpRepository(prisma);
    this.wildcardAuth = wildcardAuth;
  }

  /**
   * Check if the provided token is the wildcard token
   */
  private isWildcardToken(token: string): boolean {
    return (
      this.wildcardAuth?.allow_wildcard_token === true &&
      token === (this.wildcardAuth?.wildcard_token ?? '')
    );
  }

  /**
   * Resolve wildcard collection configuration
   * Grants access to all MCPs with MASTER or NONE auth strategies
   */
  private async resolveWildcardCollection(): Promise<CollectionResponse> {
    logger.warn('Wildcard token used - granting access to all MCPs');

    // Load all MCPs from database
    const allMcps = await this.mcpRepo.listAll();

    // Build upstreams, filtering out TOKEN_SPECIFIC MCPs
    const upstreams = allMcps
      .map((mcp) => {
        // Skip MCPs that require TOKEN_SPECIFIC auth (no credentials available for wildcard)
        if (mcp.authStrategy === "TOKEN_SPECIFIC" || (mcp.authStrategy === "MASTER" && mcp.masterAuthConfig === null)) {
          logger.info(
            { mcpId: mcp.id, namespace: mcp.namespace },
            'Skipping MCP with TOKEN_SPECIFIC auth strategy for wildcard access'
          );
          return null;
        }

        let auth: UpstreamAuthConfig | undefined;

        // Use master auth config if available
        if (mcp.masterAuthConfig) {
          try {
            auth = JSON.parse(mcp.masterAuthConfig);
          } catch (error) {
            logger.warn(
              { mcpId: mcp.id, error },
              'Failed to parse master auth config for wildcard access'
            );
            auth = undefined;
          }
        }

        return {
          namespace: mcp.namespace,
          url: mcp.url,
          author: mcp.author,
          description: mcp.description,
          version: mcp.version,
          stateless: mcp.stateless,
          auth_strategy: 'MASTER' as const,
          auth,
          token_cost: mcp.tokenCost,
          permissions: {
            allowed_tools: ['*'],
            allowed_resources: ['*'],
            allowed_prompts: ['*'],
          },
        };
      })
      .filter((upstream) => upstream !== null);

    logger.info(
      { mcpCount: upstreams.length, totalMcps: allMcps.length },
      'Wildcard collection resolved'
    );



    return {
      collection_id: 'wildcard',
      user_id: 'wildcard',
      name: 'Wildcard Access - All MCPs',
      upstreams: upstreams as any[],
    };
  }

  async resolveCollection(token: string): Promise<CollectionResponse> {
    // Check for wildcard token first

    logger.debug('Resolving collection from token');

    if (this.isWildcardToken(token)) {
      logger.debug('Wildcard token used');
      return await this.resolveWildcardCollection();
    }



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

        switch (collectionMcp.mcp.authStrategy) {
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
              { authStrategy: collectionMcp.mcp.authStrategy },
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
          auth_strategy: collectionMcp.mcp.authStrategy,
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
