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

import { PrismaClient } from "@prisma/client";
import { Bundle } from "./config/schemas.js";
import { BundleRepository } from "../api/database/repositories/BundleRepository.js";
import { AccessTokenRepository } from "../api/database/repositories/AccessTokenRepository.js";
import { McpCredentialRepository } from "../api/database/repositories/McpCredentialRepository.js";
import { McpRepository } from "../api/database/repositories/McpRepository.js";
import { createHash } from "crypto";
import logger from "../utils/logger.js";

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
  private tokenRepo: AccessTokenRepository;
  private mcpCredRepo: McpCredentialRepository;
  private mcpRepo: McpRepository;
  private prisma: PrismaClient;
  private wildcardAuth?: WildcardBundleConfig;

  constructor(prisma: PrismaClient, wildcardAuth?: WildcardBundleConfig) {
    this.prisma = prisma;
    this.bundleRepo = new BundleRepository(prisma);
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
   * Resolve wildcard bundle configuration
   * Grants access to all MCPs with MASTER or NONE auth strategies
   */
  private async resolveWildcard(): Promise<Bundle> {
    logger.warn('Wildcard token used - granting access to all MCPs');

    // Load all MCPs from database
    const allMcps = await this.mcpRepo.listAll();

    // Build upstreams, filtering out USER_SET MCPs
    const upstreams = allMcps
      .map((mcp) => {
        // Skip MCPs that require USER_SET auth (no credentials available for wildcard)
        if (mcp.authStrategy === "USER_SET" || (mcp.authStrategy === "MASTER" && mcp.masterAuth === null)) {
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



    return {
      bundleId: 'wildcard',
      name: 'Wildcard Access - All MCPs',
      upstreams: upstreams as any[],
    };
  }

  async resolveBundle(token: string): Promise<Bundle> {
    // Check for wildcard token first

    logger.debug('Resolving bundle from token');

    if (this.isWildcardToken(token)) {
      logger.debug('Wildcard token used');
      return await this.resolveWildcard();
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

    // Load and decrypt bundle with MCPs
    const bundle = await this.bundleRepo.findById(tokenRecord.bundleId);
    if (!bundle) {
      logger.warn('Bundle not found for valid token');
      const error: any = new Error('Bundle not found');
      error.status = 404;
      throw error;
    }

    const decryptedBundle = await this.bundleRepo.decryptBundle(
      bundle,
      tokenRecord.id,
      this.mcpCredRepo
    );

    if (!decryptedBundle) {
      logger.warn('Failed to decrypt bundle');
      const error: any = new Error('Bundle decryption failed');
      error.status = 500;
      throw error;
    }

    logger.info(
      {
        bundleId: decryptedBundle.id,
        bundleName: decryptedBundle.name,
        tokenId: tokenRecord.id,
        mcpCount: decryptedBundle.mcps.length,
      },
      'Successfully resolved bundle from token'
    );

    // Build MCPConfig objects from decrypted bundle
    const upstreams = decryptedBundle.mcps.map((entry) => {
      const config = {
        namespace: entry.mcp.namespace,
        url: entry.mcp.url,
        stateless: entry.mcp.stateless,
        authStrategy: entry.mcp.authStrategy,
        auth: entry.mcp.auth,
        permissions: {
          allowedTools: JSON.parse(entry.allowedTools),
          allowedResources: JSON.parse(entry.allowedResources),
          allowedPrompts: JSON.parse(entry.allowedPrompts),
        },
      };
      logger.debug({
        namespace: config.namespace,
        authType: typeof config.auth,
        auth: config.auth
      }, "Mapped MCPConfig in bundle-resolver");
      return config;
    });

    return {
      bundleId: decryptedBundle.id,
      name: decryptedBundle.name,
      upstreams: upstreams
    }
  }
}
