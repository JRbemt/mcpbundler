/**
 * Configuration Schemas - Zod validation schemas for bundler configuration
 *
 * Defines type-safe configuration schemas for the bundler server, upstream MCPs,
 * authentication methods, and permission models. Uses Zod for runtime validation
 * and TypeScript type inference.
 *
 * Key schemas:
 * - BundlerConfig: Server settings (host, port, concurrency, timeouts)
 * - UpstreamConfig: MCP server definitions with auth and permissions
 * - UpstreamAuthConfig: Six auth methods (none, bearer, basic, api_key, oauth2, mtls)
 * - AuthStrategy: How to resolve credentials (MASTER, USER_SET, NONE)
 * - McpPermissions: Granular tool/resource/prompt access control
 */

import { z } from "zod";
import { MCPAuthConfigSchema, McpPermissionsSchema } from "../../shared/domain/entities.js";

export type BundlerConfig = z.infer<typeof BundlerConfigSchema>;

export type AuthStrategy = z.infer<typeof AuthStrategySchema>;

export type Bundle = z.infer<typeof Bundle>;


const ConcurrencySchema = z.object({
    max_concurrent: z.number().min(1).default(100),
    idle_timeout_ms: z.number().min(0).default(5 * 60 * 1000),
});

export const LLMProviderConfigSchema = z.object({
    name: z.string().min(1),
    type: z.literal("openai-compatible"),
    model: z.string().min(1),
    endpoint: z.string().url(),
    api_key: z.string().optional(),
    temperature: z.number().min(0).max(2).default(0.1),
    max_tokens: z.number().min(1).default(256),
    timeout_ms: z.number().min(0).default(10000),
});

export type LLMProviderConfig = z.infer<typeof LLMProviderConfigSchema>;

/**
 * Bundler server configuration schema
 */
export const BundlerConfigSchema = z.object({
    name: z.string(),
    version: z.string(),
    host: z.string(),
    port: z.number(),

    concurrency: ConcurrencySchema
        .optional()
        .default(ConcurrencySchema.parse({})),

    loading_strategy: z.enum(["eager", "progressive"]).default("progressive"),

    llm_providers: z.array(LLMProviderConfigSchema).optional().default([]),
});

/**
 * Auth strategy for MCPs in bundles
 *
 * - MASTER: Use shared auth config from master MCP record
 * - USER_SET: Use per-subscription credentials from Subscription.credentials
 * - NONE: No authentication required
 */
export const AuthStrategySchema = z.enum(['MASTER', 'USER_SET', 'NONE']);



/**
 * Upstream MCP server configuration schema
 *
 * Complete definition for an MCP server including connection details, auth strategy,
 * credentials, metadata, and permissions.
 */
export const MCPConfigSchema = z.object({
    /** The namespace of the upstream MCP, e.g. "files", "notion", "github-api". Must match pattern: [A-Za-z0-9_.-]+ (no consecutive underscores) */
    namespace: z.string()
        .min(1)
        .regex(/^(?!.*__)([A-Za-z0-9_.-]+)$/, "Namespace must contain only letters, digits, underscores, dots, and hyphens (no consecutive underscores)"),
    /** Base URL to the provider, e.g. "http://localhost:3001" (no trailing route). */
    url: z.string().url(),

    /** Human-readable description of what this MCP provides. Used by the LLM router for namespace selection. */
    description: z.string().optional(),

    stateless: z.boolean().default(false),

    /** Auth strategy (how to resolve credentials) */
    authStrategy: AuthStrategySchema.default("MASTER"),

    /** Authentication configuration for upstream server (resolved based on auth_strategy) */
    auth: MCPAuthConfigSchema.optional(),

    /** Per-MCP permissions */
    permissions: McpPermissionsSchema.optional()
});

export type MCPConfig = z.infer<typeof MCPConfigSchema>;


/**
 * LLM tool router configuration schema
 *
 * User-controlled per access key. Signal 1 (rolling_window) and Signal 2 (set_context)
 * are independently enabled. Both feed the same reRank() path in LLMToolRouterMiddleware.
 */
export const BundleRouterConfigSchema = z.object({
    model: z.string().default("allpass"),
    llm: LLMProviderConfigSchema.optional(),
    rolling_window: z.object({
        enabled: z.boolean().default(true),
        max_active_upstreams: z.number().min(1).default(10),
        window_size: z.number().min(1).default(10),
        re_rank_every_n_calls: z.number().min(1).default(5),
    }).optional(),
    set_context: z.object({
        enabled: z.boolean().default(true),
        max_active_upstreams: z.number().min(1).default(10),
    }).optional(),
}).optional();

export type BundleRouterConfig = z.infer<typeof BundleRouterConfigSchema>;

/**
 * Bundle resolution response schema
 *
 * Returned by resolvers after validating a bundle access token. Contains bundle
 * metadata, list of accessible upstreams, and optional user-controlled router config.
 */
export const Bundle = z.object({
    bundleId: z.string(),
    name: z.string(),
    upstreams: z.array(MCPConfigSchema),
    router: BundleRouterConfigSchema,
});


