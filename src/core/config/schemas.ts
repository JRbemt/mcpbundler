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

export type BundlerConfig = z.infer<typeof BundlerConfigSchema>;

export type MCPConfig = z.infer<typeof MCPConfigSchema>;
export type MCPAuthConfig = z.infer<typeof MCPAuthConfigSchema>;
export type AuthStrategy = z.infer<typeof AuthStrategySchema>;
export type McpPermissions = z.infer<typeof McpPermissionsSchema>;

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
 * Authentication method enumeration
 */
export const AuthMethodSchema = z.enum([
    'none',
    'bearer',
    'basic',
    'api_key',
    'oauth2',
    'mtls'
]);

/**
 * Upstream authentication configuration schema
 *
 * Discriminated union supporting four auth methods: none, bearer, basic,
 * api_keys. Each method has its own required fields.
 */
export const MCPAuthConfigSchema = z.discriminatedUnion('method', [
    z.object({
        method: z.literal('none'),
    }),
    z.object({
        method: z.literal('bearer'),
        token: z.string(),
    }),
    z.object({
        method: z.literal('basic'),
        username: z.string(),
        password: z.string(),
    }),
    z.object({
        method: z.literal('api_key'),
        key: z.string(),
        header: z.string().default('X-API-Key'),
    })
]);

/**
 * Auth strategy for MCPs in bundles
 *
 * - MASTER: Use shared auth config from master MCP record
 * - USER_SET: Use per-token credentials from McpCredential table
 * - NONE: No authentication required
 */
export const AuthStrategySchema = z.enum(['MASTER', 'USER_SET', 'NONE']);

/**
 * Per-MCP permissions schema
 *
 * Controls which tools, resources, and prompts clients can access from each MCP.
 * - Use ["*"] for ALL (allow everything)
 * - Use [] for NONE (deny everything)
 * - Use specific names for granular control (e.g., ["read_file", "write_file"])
 */
export const McpPermissionsSchema = z.object({
    allowedTools: z.array(z.string()).default(["*"]),
    allowedResources: z.array(z.string()).default(["*"]),
    allowedPrompts: z.array(z.string()).default(["*"])
});


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


