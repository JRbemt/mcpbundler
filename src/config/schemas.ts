import { z } from "zod";

export type BundlerConfig = z.infer<typeof BundlerConfigSchema>;
export type UpstreamConfig = z.infer<typeof UpstreamConfigSchema>;
export type UpstreamAuthConfig = z.infer<typeof UpstreamAuthConfigSchema>;
export type AuthStrategy = z.infer<typeof AuthStrategySchema>;
export type McpPermissions = z.infer<typeof McpPermissionsSchema>;
export type CollectionResponse = z.infer<typeof CollectionResponseSchema>;
export type CollectionToken = z.infer<typeof CollectionTokenSchema>;
export type CollectionTokenMcpCredential = z.infer<typeof CollectionTokenMcpCredentialSchema>;

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

    auth: z.object({
        // The token required for clients to access all MCPS (bypass collections)
        allow_wildcard_token: z.boolean().default(true),
        // Default is empty string, meaning wihtout a token all mcps are accessed (if a wildcard token is allowed)
        wildcard_token: z.string().optional().default(""),
    }).default({}),

    concurrency: z.object({
        max_sessions: z.number().min(1).default(100),
        idle_timeout_ms: z.number().min(0).default(5 * 60 * 1000),
        startup_block_ms: z.number().min(0).default(100),
    }).default({}),

    // Optional fields for manager system integration
    manager: z.object({
        /** Unique identifier for this server instance managed by the manager */
        instance_id: z.string().optional(),
        /** Manager system endpoint for health checks and status updates */
        manager_endpoint: z.string().url().optional(),
        /** Authentication token for manager communication */
        manager_auth_token: z.string().optional(),
        /** Interval for health check reports to manager (in milliseconds) */
        health_check_interval_ms: z.number().min(1000).default(30000).optional(),
        /** Enable/disable automatic restarts on failures */
        auto_restart: z.boolean().default(false).optional(),
    }).optional(),

    // Logging configuration
    logging: z.object({
        /** Log level: debug, info, warn, error */
        level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
        /** Enable structured JSON logging */
        json: z.boolean().default(true),
        /** Log file path (optional, logs to stdout if not specified) */
        file_path: z.string().optional(),
        /** Maximum log file size in bytes before rotation */
        max_file_size: z.number().positive().optional(),
        /** Number of rotated log files to keep */
        max_files: z.number().positive().optional(),
    }).optional(),

    // Backend client configuration
    backend: z.object({
        /** Backend API base URL */
        base_url: z.string().url().default('http://localhost:8000'),
        /** Request timeout in milliseconds */
        timeout_ms: z.number().positive().default(10000),
        /** Number of retry attempts for failed requests */
        retry_attempts: z.number().min(0).default(3),
        /** Delay between retry attempts in milliseconds */
        retry_delay_ms: z.number().positive().default(1000),
    }).optional(),

    // Metering configuration
    metering: z.object({
        /** Enable/disable metering */
        enabled: z.boolean().default(true),
        /** Service token for authenticating with backend metering API */
        service_token: z.string().optional(),
        /** Flush interval in milliseconds (how often to send batches to backend) */
        flush_interval_ms: z.number().positive().default(10000),
        /** Batch size (flush when this many events are buffered) */
        batch_size: z.number().positive().default(100),
    }).optional(),
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
export const UpstreamConfigSchema = z.object({
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
    upstreams: z.array(UpstreamConfigSchema)
});

/**
* Collection token schema
*/
export const CollectionTokenSchema = z.object({
    id: z.string(),
    collection_id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    token_hash: z.string(),
    expires_at: z.date().optional(),
    revoked: z.boolean(),
    created_at: z.date()
});

/**
* Token-specific MCP credential schema
*/
export const CollectionTokenMcpCredentialSchema = z.object({
    id: z.string(),
    token_id: z.string(),
    mcp_id: z.string(),
    auth_config: UpstreamAuthConfigSchema,
    created_at: z.date(),
    updated_at: z.date()
});


