/**
 * YAML Config Loader - parses and validates a YAML bundle configuration file
 *
 * Supports ${VAR_NAME} interpolation for any string value in the file, resolved
 * from process.env. This keeps secrets (tokens, API keys) in .env while the
 * structure (MCPs, bundles, permissions) lives in the YAML file.
 *
 * Configuration blocks:
 *   definitions    - shared named resources: MCPs and LLM providers
 *   bundles        - bundles you author and publish (use `mcpbundler sync`)
 *   subscriptions  - named subscriptions to a bundle; holds credentials and router config
 *
 * Three ways to include MCPs inside bundle blocks:
 *   local ref      - ref: <namespace>   references a named entry from definitions.mcps
 *   inline entry   - namespace + url + auth_strategy defined directly; sync creates or updates the MCP record
 *
 * Key naming convention:
 *   All YAML keys use snake_case. Permissions inside subscription credentials are
 *   also snake_case (allowed_tools, allowed_resources, allowed_prompts) and are
 *   mapped to the internal camelCase representation by this loader.
 */

import { readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { parse as parseDotenv } from "dotenv";
import { parse } from "yaml";
import { z } from "zod";
import { MCPAuthConfigSchema, McpPermissionsSchema } from "../../../shared/domain/entities.js";
import { BundleRouterConfigSchema, LLMProviderConfigSchema } from "../schemas.js";
import { camelizeKeys } from "../../../shared/utils/case.js";

const NAMESPACE_PATTERN = /^(?!.*__)([A-Za-z0-9_.-]+)$/;
const NAMESPACE_MESSAGE = "Namespace must contain only letters, digits, underscores, dots, and hyphens (no consecutive underscores)";

// Permissions in subscription credential blocks are snake_case in YAML.
const YamlPermissionsSchema = z.object({
    allowed_tools: z.array(z.string()).default(["*"]),
    allowed_resources: z.array(z.string()).default(["*"]),
    allowed_prompts: z.array(z.string()).default(["*"]),
}).transform(camelizeKeys);

// Definitions block (definitions:)
// Groups shared MCP declarations and LLM providers.

// An MCP that exists on a named registry — sync adds it to bundles by namespace
// without creating or modifying the MCP record itself.
const YamlRefMcpExternalSchema = z.object({
    namespace: z.string().regex(NAMESPACE_PATTERN, NAMESPACE_MESSAGE),
    registry: z.string().min(1),
});

// An inline MCP definition — sync creates or updates this MCP on the target instance.
const YamlRefMcpInlineSchema = z.object({
    namespace: z.string().regex(NAMESPACE_PATTERN, NAMESPACE_MESSAGE),
    url: z.url(),
    stateless: z.boolean().default(false),
    auth: MCPAuthConfigSchema.optional(),
    description: z.string().optional(),
});

const YamlRefMcpSchema = z.union([YamlRefMcpExternalSchema, YamlRefMcpInlineSchema]);

const YamlLlmBindingSchema = z.object({
    provider: z.string().min(1),
    api_key: z.string().min(1),
});

const YamlDefinitionsSchema = z.object({
    mcps: z.array(YamlRefMcpSchema).optional().default([]),
    llms: z.array(LLMProviderConfigSchema).optional().default([]),
    llm_bindings: z.array(YamlLlmBindingSchema).optional().default([]),
});

// Bundle blocks (bundles:)

const AuthStrategyLiteralSchema = z.enum(["MASTER", "USER_SET", "NONE"]);

// References a namespace declared in definitions.mcps.
const YamlBundleMcpLocalRefSchema = z.object({
    ref: z.string().min(1),
    auth_strategy: AuthStrategyLiteralSchema,
});

// References an MCP that already exists on a named registry.
// sync adds it to the bundle without creating or modifying the MCP record.
const YamlBundleMcpRegistryRefSchema = z.object({
    registry: z.string().min(1),
    namespace: z.string().regex(NAMESPACE_PATTERN, NAMESPACE_MESSAGE),
    auth_strategy: AuthStrategyLiteralSchema.default("NONE"),
});

// Full inline MCP definition. sync creates the MCP if it does not yet exist
// on the target registry, or updates it if the namespace is already registered.
const YamlBundleMcpInlineSchema = z.object({
    namespace: z.string().regex(NAMESPACE_PATTERN, NAMESPACE_MESSAGE),
    url: z.url(),
    stateless: z.boolean().default(false),
    auth_strategy: AuthStrategyLiteralSchema,
    auth: MCPAuthConfigSchema.optional(),
    description: z.string().optional(),
});

const YamlBundleMcpEntrySchema = z.union([
    YamlBundleMcpLocalRefSchema,
    YamlBundleMcpRegistryRefSchema,
    YamlBundleMcpInlineSchema,
]);

const YamlBundleDefSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    mcps: z.array(YamlBundleMcpEntrySchema).default([]),
});

// Subscription blocks (subscriptions:)
//
// Each subscription has a unique local name used to generate access tokens:
//   mcpbundler token <name>
//
// Credentials are bound at the subscription level. When a token is generated for
// this subscription the server links the token to this subscription so the
// connecting client can authenticate with USER_SET MCPs.

const YamlSubscribeCredentialSchema = z.object({
    auth: MCPAuthConfigSchema,
    permissions: YamlPermissionsSchema.optional(),
});

const YamlSubscribeSchema = z.object({
    name: z.string().min(1),
    bundle: z.string().min(1),
    credentials: z.record(z.string(), YamlSubscribeCredentialSchema).optional(),
    router: BundleRouterConfigSchema,
});

// Top-level config

export const YamlConfigSchema = z.object({
    definitions: YamlDefinitionsSchema.optional().default({ mcps: [], llms: [], llm_bindings: [] }),
    bundles: z.array(YamlBundleDefSchema).optional().default([]),
    subscriptions: z.array(YamlSubscribeSchema).optional().default([]),
});

export type YamlConfig = z.infer<typeof YamlConfigSchema>;
export type YamlDefinitions = z.infer<typeof YamlDefinitionsSchema>;
export type YamlRefMcp = z.infer<typeof YamlRefMcpSchema>;
export type YamlRefMcpExternal = z.infer<typeof YamlRefMcpExternalSchema>;
export type YamlRefMcpInline = z.infer<typeof YamlRefMcpInlineSchema>;
export type YamlBundleDef = z.infer<typeof YamlBundleDefSchema>;
export type YamlBundleMcpLocalRef = z.infer<typeof YamlBundleMcpLocalRefSchema>;
export type YamlBundleMcpRegistryRef = z.infer<typeof YamlBundleMcpRegistryRefSchema>;
export type YamlBundleMcpInline = z.infer<typeof YamlBundleMcpInlineSchema>;
export type YamlBundleMcpEntry = z.infer<typeof YamlBundleMcpEntrySchema>;
export type YamlSubscribe = z.infer<typeof YamlSubscribeSchema>;
export type YamlSubscribeCredential = z.infer<typeof YamlSubscribeCredentialSchema>;
export type YamlLlmBinding = z.infer<typeof YamlLlmBindingSchema>;

// Env interpolation

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Recursively walks a parsed YAML object and replaces ${VAR_NAME} patterns
 * in string values with values from the supplied env map.
 *
 * Operating post-parse means YAML special characters in env var values
 * (e.g. colons, hashes, newlines) cannot corrupt the structure.
 */
function interpolateEnvVars(node: unknown, env: Record<string, string>): unknown {
    if (typeof node === "string") {
        return node.replace(ENV_VAR_PATTERN, (_, varName: string) => {
            const value = env[varName];
            if (value === undefined) {
                throw new Error(`Environment variable "${varName}" referenced in YAML config is not set`);
            }
            return value;
        });
    }
    if (Array.isArray(node)) {
        return node.map(item => interpolateEnvVars(item, env));
    }
    if (node !== null && typeof node === "object") {
        return Object.fromEntries(
            Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, interpolateEnvVars(v, env)])
        );
    }
    return node;
}

/**
 * Loads and validates a YAML bundle config file.
 * ${VAR_NAME} references in string values are resolved from process.env
 * after YAML parsing, so env var contents cannot affect the YAML structure.
 *
/**
 * Builds the env map for YAML interpolation: parses a .env file from the same
 * directory as the config, then merges with process.env (process.env wins).
 *
 * @param configPath - Absolute or cwd-relative path to the YAML file
 */
export function buildEnvForConfig(configPath: string): Record<string, string> {
    const absolutePath = resolve(process.cwd(), configPath);
    let fileEnv: Record<string, string> = {};
    try {
        const raw = readFileSync(join(dirname(absolutePath), ".env"), "utf-8");
        fileEnv = parseDotenv(raw);
    } catch {
        // No .env next to the YAML — rely on process.env alone.
    }
    return { ...fileEnv, ...(process.env as Record<string, string>) };
}

/**
 * Loads and validates a YAML bundle config file.
 * ${VAR_NAME} references in string values are resolved from the supplied env map.
 *
 * @param configPath - Absolute or cwd-relative path to the YAML file
 * @param env - Variable map used for interpolation; build with buildEnvForConfig()
 */
export function loadYamlConfig(configPath: string, env: Record<string, string>): YamlConfig {
    const absolutePath = resolve(process.cwd(), configPath);

    let raw: string;
    try {
        raw = readFileSync(absolutePath, "utf-8");
    } catch (cause) {
        throw new Error(`Cannot read YAML config at "${absolutePath}": ${cause}`);
    }

    let parsed: unknown;
    try {
        parsed = parse(raw);
    } catch (cause) {
        throw new Error(`YAML parse error in "${absolutePath}": ${cause}`);
    }

    try {
        parsed = interpolateEnvVars(parsed, env);
    } catch (cause) {
        throw new Error(`YAML config env interpolation failed: ${cause}`);
    }

    const result = YamlConfigSchema.safeParse(parsed);
    if (!result.success) {
        const messages = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
        throw new Error(`Invalid YAML config:\n${messages}`);
    }

    return result.data;
}
