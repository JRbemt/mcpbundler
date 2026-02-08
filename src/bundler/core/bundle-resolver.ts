/**
 * Bundle Resolver - Token validation and bundle configuration resolution
 *
 * Validates bundle access tokens and resolves them to complete bundle configurations
 * with upstream MCPs and authentication credentials. Tokens are SHA-256 hashed and
 * checked for expiration and revocation.
 *
 * Three authentication strategies are supported:
 * - MASTER: Shared auth config from the master MCP record (for public APIs)
 * - USER_SET: Per-token credentials in McpCredential table (for multi-tenant)
 * - NONE: No authentication required (for public upstreams)
 *
 * MCPs with USER_SET auth but missing credentials are gracefully excluded. An optional wildcard token for development grants access to all MCPs
 * except USER_SET ones.
 */

import { PrismaClient, AuthStrategy, MCPAuthConfig, MCPAuthConfigSchema, Mcp } from "../../shared/domain/entities.js";
import { Bundle, MCPConfig } from "./schemas.js";
import { McpCredentialRepository, BundleRepository, BundleTokenRepository, McpRepository } from "../../shared/infra/repository/index.js";
import { decryptJSON, hashApiKey } from "../../shared/utils/encryption.js";
import logger from "../../shared/utils/logger.js";
import { BundleWithMcpsAndCreator } from "../../shared/infra/repository/BundleRepository.js";

/**
 * Wildcard authentication configuration,
 * allowing a special token to access all MCPs (that have auth set to MASTER or NONE)
 */
export interface WildcardBundleConfig {
  allow_wildcard_token: boolean;
  wildcard_token?: string;
}

/**
 * Interface for resloving bundle configurations
 * 
 */
export interface ResolverService {
  /**
   * Resolve a bundle token to its configuration
   *
   * @param token - Bundle token (e.g., "mcpb_live_...")
   * @returns Bundle configuration with upstreams
   * @throws Error if token is invalid, expired, or revoked
   */
  resolveBundle(token: string): Promise<Bundle>;
}


/**
 * Database-backed authentication service
 * Resolves bundle tokens to their MCP configurations with auth
 */
export class DBBundleResolver implements ResolverService {
  private bundleRepo: BundleRepository;
  private tokenRepo: BundleTokenRepository;
  private mcpCredRepo: McpCredentialRepository;
  private mcpRepo: McpRepository;
  private prisma: PrismaClient;
  private wildcardAuth?: WildcardBundleConfig;

  constructor(prisma: PrismaClient, wildcardAuth?: WildcardBundleConfig) {
    this.prisma = prisma;
    this.bundleRepo = new BundleRepository(prisma);
    this.tokenRepo = new BundleTokenRepository(prisma);
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
   * Resolve wildcard bundle configuration
   * Grants access to all MCPs with MASTER or NONE auth strategies
   */
  private async resolveWildcard(): Promise<Mcp[]> {
    logger.warn('Wildcard token used - granting access to all MCPs');

    // Load all MCPs from database
    const allMcps = await this.mcpRepo.listAll();

    // Build upstreams, filtering out USER_SET MCPs
    const upstreams = allMcps
      .map((mcp) => {
        // Skip MCPs that require USER_SET auth (no credentials available for wildcard)
        if (mcp.authStrategy === AuthStrategy.USER_SET || (mcp.authStrategy === AuthStrategy.MASTER && mcp.masterAuth === null)) {
          logger.info(
            { mcpId: mcp.id, namespace: mcp.namespace },
            'Skipping MCP with USER_SET auth strategy for wildcard access'
          );
          return null;
        }

        // MCP auth will be decrypted by repository layer
        return mcp;
      }).filter((upstream) => upstream !== null);

    logger.info(
      { mcpCount: upstreams.length, totalMcps: allMcps.length },
      'Wildcard bundle resolved'
    );

    return upstreams;
  }

  async resolveBundle(token: string): Promise<Bundle> {
    // Check for wildcard token first

    logger.debug('Resolving bundle from token');

    if (this.isWildcardToken(token)) {
      logger.debug('Wildcard token used');
      const upstreams = await this.resolveWildcard();
      const mcpConfigs: MCPConfig[] = upstreams.map((mcp) => {
        return {
          ...mcp,
          auth: ((mcp.authStrategy === AuthStrategy.MASTER) && mcp.masterAuth) ? MCPAuthConfigSchema.parse(decryptJSON(mcp.masterAuth)) : undefined,
          permissions: {
            allowedPrompts: ["*"],
            allowedResources: ["*"],
            allowedTools: ["*"]
          }
        }
      });

      return {
        bundleId: "",
        name: "all",
        upstreams: mcpConfigs
      }
    }



    // Find token record
    const tokenHash = hashApiKey(token);
    const tokenRecord = await this.tokenRepo.findByHash(tokenHash);

    if (!tokenRecord || !this.tokenRepo.isValid(tokenRecord)) {
      logger.warn('Invalid or expired token');
      const error: any = new Error('Invalid or expired token');
      error.status = 401;
      throw error;
    }

    // Load and decrypt bundle with MCPs
    const bundle = await this.bundleRepo.findById(tokenRecord.bundleId);
    if (!bundle) {
      logger.warn('Bundle not found for valid token');
      const error: any = new Error('Bundle not found');
      error.status = 404;
      throw error;
    }

    logger.info(
      {
        bundleId: bundle.id,
        bundleName: bundle.name,
        tokenId: tokenRecord.id,
        mcpCount: bundle.mcps.length,
      },
      "Successfully resolved bundle from token"
    );

    return {
      bundleId: bundle.id,
      name: bundle.name,
      upstreams: await this.transformToBundle(bundle.mcps, tokenRecord.id)
    }
  }

  /**
   * Transform database bundle to application Bundle with resolved auth
   *
   * Resolves authentication configuration for each MCP based on its authStrategy:
   * - MASTER: Uses masterAuth from the MCP record (decrypted)
   * - USER_SET: Looks up credentials from BundledMcpCredential by tokenId + mcpId
   * - NONE: No authentication required
   *
   * MCPs with USER_SET strategy that are missing credentials are excluded from the bundle.
   *
   * @param dbBundle - Database bundle with nested MCPs
   * @param tokenId - Token ID for USER_SET credential lookup
   * @returns Application Bundle with resolved upstreams
   */
  private async transformToBundle(
    dbBundle: BundleWithMcpsAndCreator["mcps"],
    tokenId: string
  ): Promise<MCPConfig[]> {
    const upstreams: MCPConfig[] = [];

    for (const entry of dbBundle) {
      const mcp = entry.mcp;
      let auth: MCPAuthConfig = { method: "none" };

      switch (mcp.authStrategy) {
        case AuthStrategy.MASTER:
          if (mcp.masterAuth) {
            try {
              const decrypted = decryptJSON(mcp.masterAuth);
              auth = MCPAuthConfigSchema.parse(decrypted);
            } catch (error) {
              logger.error({ mcpId: mcp.id, namespace: mcp.namespace }, "Failed to decrypt MASTER auth");
              auth = { method: "none" };
            }
          }
          break;

        case AuthStrategy.USER_SET:
          const credential = await this.mcpCredRepo.findByTokenAndMcp(tokenId, mcp.id);
          if (credential) {
            auth = this.mcpCredRepo.decryptAuth(credential.authConfig);
          } else {
            logger.warn(
              { mcpId: mcp.id, namespace: mcp.namespace, tokenId },
              "USER_SET MCP missing credentials - excluding from bundle"
            );
            continue;
          }
          break;

        case AuthStrategy.NONE:
        default:
          auth = { method: "none" };
          break;
      }

      const config: MCPConfig = {
        ...mcp,
        auth: auth,
        permissions: {
          allowedTools: JSON.parse(entry.allowedTools),
          allowedResources: JSON.parse(entry.allowedResources),
          allowedPrompts: JSON.parse(entry.allowedPrompts),
        },
      };

      logger.debug(
        { namespace: config.namespace, authMethod: auth.method },
        "Resolved MCP config in bundle-resolver"
      );

      upstreams.push(config);
    }
    console.log(upstreams);
    return upstreams;
  }
}
