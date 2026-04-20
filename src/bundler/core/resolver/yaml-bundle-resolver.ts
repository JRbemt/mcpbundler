/**
 * YAML Bundle Resolver - resolves bundle tokens from a static YAML config
 *
 * Implements ResolverService against an in-memory token map built at startup
 * from a validated YamlConfig. No database or encryption key is required;
 * credentials live in environment variables referenced from the YAML file.
 *
 * Each bundle token is SHA-256 hashed at startup for constant-time lookup,
 * matching the same hashing convention used by DBBundleResolver.
 */

import { Bundle, MCPConfig } from "../schemas.js";
import { ResolverService } from "./service.js";
import { YamlConfig, YamlBundleMcpRef, YamlBundleMcpInline } from "./yaml-config-loader.js";
import { hashApiKey } from "../../../shared/utils/encryption.js";
import logger from "../../../shared/utils/logger.js";

function isRef(entry: YamlBundleMcpRef | YamlBundleMcpInline): entry is YamlBundleMcpRef {
  return "ref" in entry;
}

const DEFAULT_PERMISSIONS = {
  allowedTools: ["*"],
  allowedResources: ["*"],
  allowedPrompts: ["*"],
};

function resolveUpstreams(
  bundleName: string,
  entries: YamlConfig["bundles"][number]["mcps"],
  mcpDefs: YamlConfig["mcps"]
): MCPConfig[] {
  const upstreams: MCPConfig[] = [];

  for (const entry of entries) {
    if (isRef(entry)) {
      const def = mcpDefs[entry.ref];
      if (!def) {
        const available = Object.keys(mcpDefs).join(", ") || "(none)";
        throw new Error(`Bundle "${bundleName}" references unknown MCP "${entry.ref}". Available: ${available}`);
      }
      upstreams.push({
        namespace: entry.namespace ?? entry.ref,
        url: def.url,
        stateless: def.stateless,
        authStrategy: def.auth ? "MASTER" : "NONE",
        auth: def.auth,
        permissions: entry.permissions ?? DEFAULT_PERMISSIONS,
      });
    } else {
      upstreams.push({
        namespace: entry.namespace,
        url: entry.url,
        stateless: entry.stateless,
        authStrategy: entry.auth ? "MASTER" : "NONE",
        auth: entry.auth,
        permissions: entry.permissions ?? DEFAULT_PERMISSIONS,
      });
    }
  }

  return upstreams;
}

export class YamlBundleResolver implements ResolverService {
  private readonly tokenMap: Map<string, Bundle> = new Map();

  constructor(config: YamlConfig) {
    for (const bundleDef of config.bundles) {
      const upstreams = resolveUpstreams(bundleDef.name, bundleDef.mcps, config.mcps);
      const tokenHash = hashApiKey(bundleDef.token);

      if (this.tokenMap.has(tokenHash)) {
        throw new Error(`Duplicate token detected for bundle "${bundleDef.name}"`);
      }

      this.tokenMap.set(tokenHash, {
        bundleId: tokenHash.slice(0, 16),
        name: bundleDef.name,
        upstreams,
      });

      logger.debug({ bundleName: bundleDef.name, mcpCount: upstreams.length }, "Registered YAML bundle");
    }

    logger.info({ bundleCount: this.tokenMap.size }, "YamlBundleResolver initialized");
  }

  async resolveBundle(token: string): Promise<Bundle> {
    const tokenHash = hashApiKey(token);
    const bundle = this.tokenMap.get(tokenHash);

    if (!bundle) {
      const err: any = new Error("Invalid or unknown token");
      err.status = 401;
      throw err;
    }

    logger.info(
      { bundleName: bundle.name, mcpCount: bundle.upstreams.length },
      "Bundle resolved from YAML config"
    );

    return bundle;
  }
}
