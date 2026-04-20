/**
 * YAML Config Loader - parses and validates a YAML bundle configuration file
 *
 * Supports ${VAR_NAME} interpolation for any string value in the file, resolved
 * from process.env. This keeps secrets (tokens, API keys) in .env while the
 * structure (MCPs, bundles, permissions) lives in the YAML file.
 *
 * Two ways to define MCPs inside a bundle:
 * - ref entry: references a named MCP from the top-level `mcps` map
 * - inline entry: full MCP definition (namespace + url + auth) directly in the bundle
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import { z } from "zod";
import { MCPAuthConfigSchema, McpPermissionsSchema } from "../../../shared/domain/entities.js";

const NAMESPACE_PATTERN = /^(?!.*__)([A-Za-z0-9_.-]+)$/;

const YamlMcpDefinitionSchema = z.object({
  url: z.url(),
  stateless: z.boolean().default(false),
  auth: MCPAuthConfigSchema.optional(),
  description: z.string().optional(),
});

const YamlBundleMcpRefSchema = z.object({
  ref: z.string(),
  namespace: z.string().regex(NAMESPACE_PATTERN).optional(),
  permissions: McpPermissionsSchema.optional(),
});

const YamlBundleMcpInlineSchema = z.object({
  namespace: z.string().regex(NAMESPACE_PATTERN, "Namespace must contain only letters, digits, underscores, dots, and hyphens (no consecutive underscores)"),
  url: z.url(),
  stateless: z.boolean().default(false),
  auth: MCPAuthConfigSchema.optional(),
  permissions: McpPermissionsSchema.optional(),
});

export const YamlBundleMcpEntrySchema = z.union([YamlBundleMcpRefSchema, YamlBundleMcpInlineSchema]);

const YamlBundleSchema = z.object({
  name: z.string().min(1),
  token: z.string().min(1),
  mcps: z.array(YamlBundleMcpEntrySchema).default([]),
});

export const YamlConfigSchema = z.object({
  mcps: z.record(z.string(), YamlMcpDefinitionSchema).optional().default({}),
  bundles: z.array(YamlBundleSchema).min(1, "At least one bundle must be defined"),
});

export type YamlConfig = z.infer<typeof YamlConfigSchema>;
export type YamlBundleMcpRef = z.infer<typeof YamlBundleMcpRefSchema>;
export type YamlBundleMcpInline = z.infer<typeof YamlBundleMcpInlineSchema>;

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Recursively walks a parsed YAML object and replaces ${VAR_NAME} patterns
 * in string values with values from process.env.
 *
 * Operating post-parse means YAML special characters in env var values
 * (e.g. colons, hashes, newlines) cannot corrupt the structure.
 */
function interpolateEnvVars(node: unknown): unknown {
  if (typeof node === "string") {
    return node.replace(ENV_VAR_PATTERN, (_, varName: string) => {
      const value = process.env[varName];
      if (value === undefined) {
        throw new Error(`Environment variable "${varName}" referenced in YAML config is not set`);
      }
      return value;
    });
  }
  if (Array.isArray(node)) {
    return node.map(interpolateEnvVars);
  }
  if (node !== null && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, interpolateEnvVars(v)])
    );
  }
  return node;
}

/**
 * Loads and validates a YAML bundle config file.
 * ${VAR_NAME} references in string values are resolved from process.env
 * after YAML parsing, so env var contents cannot affect the YAML structure.
 *
 * @param configPath - Absolute or cwd-relative path to the YAML file
 */
export function loadYamlConfig(configPath: string): YamlConfig {
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
    parsed = interpolateEnvVars(parsed);
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
