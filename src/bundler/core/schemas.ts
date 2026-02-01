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
})

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
        .default(ConcurrencySchema.parse({}))
});

/**
 * Auth strategy for MCPs in bundles
 *
 * - MASTER: Use shared auth config from master MCP record
 * - USER_SET: Use per-token credentials from McpCredential table
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
 * Bundle resolution response schema
 *
 * Returned by DBBundleResolver.resolveBundle() after validating a bundle
 * access token. Contains bundle metadata and list of accessible upstreams.
 */
export const Bundle = z.object({
    bundleId: z.string(),
    name: z.string(),
    upstreams: z.array(MCPConfigSchema)
});


