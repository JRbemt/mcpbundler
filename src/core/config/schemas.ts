import { z } from "zod";

export type BundlerConfig = z.infer<typeof BundlerConfigSchema>;
export type UpstreamConfig = z.infer<typeof UpstreamMCPConfigSchema>;
export type UpstreamAuthConfig = z.infer<typeof UpstreamAuthConfigSchema>;
export type AuthStrategy = z.infer<typeof AuthStrategySchema>;
export type McpPermissions = z.infer<typeof McpPermissionsSchema>;
export type CollectionResponse = z.infer<typeof CollectionResponseSchema>;

/***
 * Service Router Configuration
 * - Validates and parses configuration from environment variables or defaults.
 * - Configuration includes service name, version, host, port, and timeout.
 * - Extendable for additional settings like upstream providers, max sessions, etc.
 * - Uses Zod for schema validation and type inference.
 */
export const BundlerConfigSchema = z.object({
    name: z.string(),
    version: z.string(),
    host: z.string(),
    port: z.number(),

    concurrency: z.object({
        max_sessions: z.number().min(1).default(100),
        idle_timeout_ms: z.number().min(0).default(5 * 60 * 1000),
    }).default({}),
});


/**
* Authentication schemas for upstream MCP servers
*/
export const AuthMethodSchema = z.enum([
    'none',
    'bearer',
    'basic',
    'api_key',
    'oauth2',
    'mtls'
]);

export const UpstreamAuthConfigSchema = z.discriminatedUnion('method', [
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
    }),
    z.object({
        method: z.literal('oauth2'),
        access_token: z.string(),
        refresh_token: z.string().optional(),
        expires_at: z.number().optional(),
    }),
    z.object({
        method: z.literal('mtls'),
        client_cert: z.string(),  // PEM encoded
        client_key: z.string(),   // PEM encoded
        ca_cert: z.string().optional(),
    }),
]);

/**
* Auth strategy for MCPs in collections
*/
export const AuthStrategySchema = z.enum(['MASTER', 'TOKEN_SPECIFIC', 'NONE']);

/**
* Per-MCP permissions schema
* - Use ["*"] for ALL (allow all tools/resources/prompts)
* - Use [] for NONE (deny all)
* - Use specific names for granular control
*/
export const McpPermissionsSchema = z.object({
    allowed_tools: z.array(z.string()).default(["*"]),
    allowed_resources: z.array(z.string()).default(["*"]),
    allowed_prompts: z.array(z.string()).default(["*"])
});


/**
* Upstream provider definitions
*/
export const UpstreamMCPConfigSchema = z.object({
    /** The namespace of the upstream MCP, e.g. "files", "notion", etc. */
    namespace: z.string().min(1),
    /** A logical ID of the bundler/router as seen by the provider (optional semantics). */
    bundlerId: z.string().min(1).optional(),
    /** Base URL to the provider, e.g. "http://localhost:3001" (no trailing route). */
    url: z.string().url(),
    /** Author of the MCP server */
    author: z.string().min(1),
    /** Description of the MCP server functionality */
    description: z.string().min(1),
    /** Version string to present as the client name when connecting. */
    version: z.string().min(1),

    stateless: z.boolean().default(false),

    /** Auth strategy (how to resolve credentials) */
    auth_strategy: AuthStrategySchema.default('MASTER'),

    /** Authentication configuration for upstream server (resolved based on auth_strategy) */
    auth: UpstreamAuthConfigSchema.optional(),

    /** Cost per 1KB of data transferred (for metering) */
    token_cost: z.number().positive().default(0.0),

    /** Per-MCP permissions */
    permissions: McpPermissionsSchema.optional()
});

/**
* Collection resolution response from backend /resolve endpoint
*/
export const CollectionResponseSchema = z.object({
    collection_id: z.string(),
    user_id: z.string(),
    name: z.string(),
    upstreams: z.array(UpstreamMCPConfigSchema)
});


