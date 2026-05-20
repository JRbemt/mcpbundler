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

import { PrismaClient, AuthStrategy, MCPAuthConfig, MCPAuthConfigSchema, Mcp } from "../../../shared/domain/entities.js";
import { Bundle, BundleRouterConfig, BundleRouterConfigSchema, MCPConfig } from "../schemas.js";
import { BundleRepository, BundleTokenRepository, McpRepository, SubscriptionRepository, LlmProviderRepository } from "../../../shared/infra/repository/index.js";
import { decryptJSON, hashApiKey } from "../../../shared/utils/encryption.js";
import logger from "../../../shared/utils/logger.js";
import { BundleWithMcpsAndCreator } from "../../../shared/infra/repository/BundleRepository.js";
import { ResolverService } from "./service.js";

/**
 * Wildcard authentication configuration,
 * allowing a special token to access all MCPs (that have auth set to MASTER or NONE)
 */
export interface WildcardBundleConfig {
  allow_wildcard_token: boolean;
  wildcard_token?: string;
}

/**
 * Database-backed authentication service
 * Resolves bundle tokens to their MCP configurations with auth
 */
export class DBBundleResolver implements ResolverService {
  private bundleRepo: BundleRepository;
  private tokenRepo: BundleTokenRepository;
  private mcpRepo: McpRepository;
  private subscriptionRepo: SubscriptionRepository;
  private llmProviderRepo: LlmProviderRepository;
  private prisma: PrismaClient;
  private wildcardAuth?: WildcardBundleConfig;

  constructor(prisma: PrismaClient, wildcardAuth?: WildcardBundleConfig) {
    this.prisma = prisma;
    this.bundleRepo = new BundleRepository(prisma);
    this.tokenRepo = new BundleTokenRepository(prisma);
    this.mcpRepo = new McpRepository(prisma);
    this.subscriptionRepo = new SubscriptionRepository(prisma);
    this.llmProviderRepo = new LlmProviderRepository(prisma);
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
        upstreams: mcpConfigs,
        router: undefined,
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

    // Resolve credentials: subscription-level blob takes precedence over legacy per-token credentials
    let subscriptionCredentials: Record<string, MCPAuthConfig> | undefined;
    let subscriptionRouter: BundleRouterConfig;

    if (tokenRecord.subscriptionId) {
      const sub = await this.subscriptionRepo.findById(tokenRecord.subscriptionId);
      if (sub?.credentials) {
        subscriptionCredentials = this.subscriptionRepo.decryptCredentials(sub.credentials);
      }
      subscriptionRouter = sub?.router ? this.parseRouterConfig(sub.router) : undefined;
    }

    // Token-level router overrides subscription router
    let router = this.parseRouterConfig(tokenRecord.router ?? null) ?? subscriptionRouter;

    // Resolve registry LLM config for the router model if the token owner is known
    if (router?.model && router.model !== "allpass" && tokenRecord.createdById) {
      const llmConfig = await this.llmProviderRepo.resolveForUser(router.model, tokenRecord.createdById);
      if (llmConfig) {
        router = { ...router, llm: llmConfig };
      }
    }

    return {
      bundleId: bundle.id,
      name: bundle.name,
      upstreams: await this.transformToBundle(bundle.mcps, subscriptionCredentials),
      router,
    }
  }

  private parseRouterConfig(raw: string | null): BundleRouterConfig {
    if (!raw) return undefined;
    try {
      return BundleRouterConfigSchema.parse(JSON.parse(raw));
    } catch {
      logger.warn("BundleAccessToken.router contains invalid JSON - ignoring");
      return undefined;
    }
  }

  /**
   * Transform database bundle to application Bundle with resolved auth
   *
   * Resolves authentication configuration for each MCP based on its authStrategy:
   * - MASTER: Shared credentials from the MCP record (decrypted from masterAuth)
   * - USER_SET: Per-namespace credentials from the subscription blob; MCPs with
   *             no matching credential entry are excluded from the bundle
   * - NONE: No authentication required
   *
   * @param dbBundle - Database bundle with nested MCPs
   * @param subscriptionCredentials - Decrypted credential map from Subscription.credentials
   * @returns Application Bundle with resolved upstreams
   */
  private async transformToBundle(
    dbBundle: BundleWithMcpsAndCreator["mcps"],
    subscriptionCredentials?: Record<string, MCPAuthConfig>
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
          if (subscriptionCredentials?.[mcp.namespace]) {
            auth = subscriptionCredentials[mcp.namespace];
          } else {
            logger.warn(
              { mcpId: mcp.id, namespace: mcp.namespace },
              "USER_SET MCP has no subscription credential - excluding from bundle"
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
    return upstreams;
  }
}
