import { banner, BG_COLORS } from "../utils/print-utils.js";
import {
  loadYamlConfig,
  YamlBundleDef,
  YamlBundleMcpEntry,
  YamlSubscribe,
  YamlConfig,
  YamlRegistry,
  YamlLlmBinding,
} from "../../bundler/core/resolver/yaml-config-loader.js";
import { BundlerAPIClient } from "../utils/api-client.js";
import type { CreateMcpRequest } from "../../api/routes/mcps.js";
import type { BundleResponse } from "../../api/routes/bundles.js";

interface SyncOptions {
  config: string;
  host: string;
  token?: string;
}

type InlineMcpData = {
  url: string;
  description: string;
  stateless: boolean;
  authStrategy: "MASTER" | "USER_SET" | "NONE";
  auth?: Record<string, unknown>;
};

function classifyMcp(entry: YamlBundleMcpEntry): "local-ref" | "registry-ref" | "inline" {
  if ("ref" in entry) return "local-ref";
  if ("url" in entry) return "inline";
  return "registry-ref";
}

function describeMcp(entry: YamlBundleMcpEntry): string {
  switch (classifyMcp(entry)) {
    case "local-ref": return `ref:${(entry as any).ref}  [local ref]`;
    case "registry-ref": return `${(entry as any).registry}/${(entry as any).namespace}  [registry ref]`;
    case "inline": return `${(entry as any).namespace}  ${(entry as any).url}  [inline]`;
  }
}

function reportBundle(def: YamlBundleDef): void {
  const targets = def.sync_to?.map(t => t.registry).join(", ") ?? "(no sync_to targets)";
  console.log(`  ${def.name}  ->  ${targets}`);
  for (const mcp of def.mcps) {
    console.log(`    ${describeMcp(mcp)}`);
  }
}

function reportSubscription(sub: YamlSubscribe): void {
  const credCount = sub.credentials ? Object.keys(sub.credentials).length : 0;
  console.log(`  ${sub.name}  (bundle: ${sub.bundle}, registry: ${sub.registry})`);
  if (credCount > 0) {
    console.log(`    Credentials: ${Object.keys(sub.credentials!).join(", ")}`);
  }
}

/**
 * Collect all inline MCP definitions from definitions.mcps and bundle inline entries.
 * Bundle inline entries override definitions entries for the same namespace (higher priority).
 */
function collectInlineMcps(config: YamlConfig): Map<string, InlineMcpData> {
  const result = new Map<string, InlineMcpData>();

  for (const mcp of config.definitions.mcps) {
    if ("url" in mcp) {
      result.set(mcp.namespace, {
        url: mcp.url,
        description: mcp.description ?? "",
        stateless: mcp.stateless,
        authStrategy: mcp.auth ? "MASTER" : "NONE",
        auth: mcp.auth as Record<string, unknown> | undefined,
      });
    }
  }

  for (const bundle of config.bundles) {
    for (const entry of bundle.mcps) {
      if ("url" in entry && "namespace" in entry) {
        result.set(entry.namespace, {
          url: entry.url,
          description: entry.description ?? "",
          stateless: entry.stateless,
          authStrategy: entry.auth_strategy,
          auth: entry.auth as Record<string, unknown> | undefined,
        });
      }
    }
  }

  return result;
}

/**
 * Resolve a bundle MCP entry to its namespace on the local registry.
 * Local refs resolve to the ref value (which is the namespace in definitions).
 */
function resolveNamespace(entry: YamlBundleMcpEntry): string {
  if ("ref" in entry) return entry.ref;
  return (entry as any).namespace as string;
}

/**
 * Upsert a single MCP on the local registry.
 * Creates if not found, updates if owned by caller, skips with warning if not owner.
 */
async function upsertMcpByNamespace(
  client: BundlerAPIClient,
  namespace: string,
  data: InlineMcpData
): Promise<void> {
  const mcpPayload: CreateMcpRequest = {
    namespace,
    url: data.url,
    description: data.description,
    version: "1.0.0",
    stateless: data.stateless,
    authStrategy: data.authStrategy,
    masterAuth: data.authStrategy === "MASTER" ? data.auth as any : undefined,
  };

  try {
    await client.getMcpByNamespace(namespace);
    const { namespace: _ns, ...updatePayload } = mcpPayload;
    await client.updateMcp(namespace, updatePayload);
    console.log(`  Updated MCP "${namespace}"`);
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404) {
      try {
        await client.createMcp(mcpPayload);
        console.log(`  Created MCP "${namespace}"`);
      } catch (createErr: any) {
        const detail = createErr?.response?.data?.error ?? createErr.message;
        console.error(`  Failed to create MCP "${namespace}": ${detail}`);
      }
    } else if (status === 403) {
      console.warn(`  MCP "${namespace}" is owned by another user - skipping`);
    } else {
      const detail = err?.response?.data?.error ?? err.message;
      console.error(`  Failed to upsert MCP "${namespace}": ${detail}`);
    }
  }
}

/**
 * Find or create a bundle by name, then reconcile MCP membership.
 * Returns the bundle ID on success, null if the bundle could not be created.
 */
async function syncBundleDef(
  client: BundlerAPIClient,
  bundleDef: YamlBundleDef,
  myBundles: BundleResponse[]
): Promise<string | null> {
  const existing = myBundles.find(b => b.name === bundleDef.name);
  let bundleId: string;

  if (!existing) {
    try {
      const created = await client.createBundle(bundleDef.name, bundleDef.description ?? "");
      bundleId = created.id;
      console.log(`  Created bundle "${bundleDef.name}" (${bundleId})`);
    } catch (err: any) {
      const detail = err?.response?.data?.error ?? err.message;
      console.error(`  Failed to create bundle "${bundleDef.name}": ${detail}`);
      return null;
    }
  } else {
    bundleId = existing.id;
    console.log(`  Found bundle "${bundleDef.name}" (${bundleId})`);

    if (bundleDef.description !== undefined && existing.description !== bundleDef.description) {
      try {
        await client.updateBundle(bundleId, { description: bundleDef.description });
        console.log(`  Updated description for bundle "${bundleDef.name}"`);
      } catch (err: any) {
        const detail = err?.response?.data?.error ?? err.message;
        console.warn(`  Could not update description for bundle "${bundleDef.name}": ${detail}`);
      }
    }
  }

  const desiredNamespaces = new Set(bundleDef.mcps.map(resolveNamespace));
  const currentNamespaces = new Set((existing?.mcps ?? []).map(m => m.namespace));

  const toAdd = [...desiredNamespaces].filter(ns => !currentNamespaces.has(ns));
  const toRemove = [...currentNamespaces].filter(ns => !desiredNamespaces.has(ns));

  for (const ns of toAdd) {
    try {
      await client.addMcpToBundle(bundleId, { namespace: ns });
      console.log(`    Added "${ns}" to bundle "${bundleDef.name}"`);
    } catch (err: any) {
      const detail = err?.response?.data?.error ?? err.message;
      console.error(`    Failed to add "${ns}" to bundle "${bundleDef.name}": ${detail}`);
    }
  }

  for (const ns of toRemove) {
    try {
      await client.deleteMcpFromBundle(bundleId, ns);
      console.log(`    Removed "${ns}" from bundle "${bundleDef.name}"`);
    } catch (err: any) {
      const detail = err?.response?.data?.error ?? err.message;
      console.error(`    Failed to remove "${ns}" from bundle "${bundleDef.name}": ${detail}`);
    }
  }

  if (toAdd.length === 0 && toRemove.length === 0) {
    console.log(`    MCP membership already up to date`);
  }

  return bundleId;
}

/**
 * Collect inline MCPs that are directly referenced by a single bundle definition.
 * Only inline entries (those with a url) from the bundle mcps list and their
 * matching definitions.mcps entries are included — registry-refs are skipped.
 */
function collectBundleInlineMcps(
  bundleDef: YamlBundleDef,
  config: YamlConfig
): Map<string, InlineMcpData> {
  const result = new Map<string, InlineMcpData>();

  for (const entry of bundleDef.mcps) {
    if ("ref" in entry) {
      const def = config.definitions.mcps.find(m => m.namespace === entry.ref);
      if (def && "url" in def) {
        result.set(def.namespace, {
          url: def.url,
          description: def.description ?? "",
          stateless: def.stateless,
          authStrategy: def.auth ? "MASTER" : "NONE",
          auth: def.auth as Record<string, unknown> | undefined,
        });
      }
    } else if ("url" in entry && "namespace" in entry) {
      result.set(entry.namespace, {
        url: entry.url,
        description: entry.description ?? "",
        stateless: entry.stateless,
        authStrategy: entry.auth_strategy,
        auth: entry.auth as Record<string, unknown> | undefined,
      });
    }
  }

  return result;
}

/**
 * Build a BundlerAPIClient for a named registry.
 * Returns null if the registry is not found or uses OAuth2 (not yet supported).
 */
function clientForRegistry(
  registryName: string,
  config: YamlConfig
): BundlerAPIClient | null {
  const reg = config.definitions.registries.find(r => r.name === registryName);
  if (!reg) {
    console.warn(`  Registry "${registryName}" not found in definitions.registries - skipping`);
    return null;
  }
  if (reg.auth.method === "oauth2") {
    console.warn(`  Registry "${registryName}" uses OAuth2 authentication which is not yet supported - skipping`);
    return null;
  }
  return new BundlerAPIClient(reg.url, reg.auth.token);
}

/**
 * Push a single bundle (and its inline MCPs) to a named remote registry.
 */
async function syncBundleToRegistry(
  bundleDef: YamlBundleDef,
  registryName: string,
  config: YamlConfig
): Promise<void> {
  const client = clientForRegistry(registryName, config);
  if (!client) return;

  console.log(`  Pushing bundle "${bundleDef.name}" to registry "${registryName}"...`);

  const bundleInlineMcps = collectBundleInlineMcps(bundleDef, config);
  for (const [namespace, mcpData] of bundleInlineMcps) {
    await upsertMcpByNamespace(client, namespace, mcpData);
  }

  const myBundles = await client.listMyBundles().catch(() => [] as BundleResponse[]);
  const bundleId = await syncBundleDef(client, bundleDef, myBundles);
  if (bundleId) {
    console.log(`  Bundle "${bundleDef.name}" synced to registry "${registryName}" (${bundleId})`);
  }
}

/**
 * Upsert a single subscription by name.
 * Resolves the bundle from the local bundleIdByName map first, then falls back to
 * matching by name within the caller's visible bundles.
 */
async function syncSubscription(
  client: BundlerAPIClient,
  sub: YamlSubscribe,
  bundleIdByName: Map<string, string>,
  myBundles: BundleResponse[]
): Promise<void> {
  let bundleId = bundleIdByName.get(sub.bundle);

  if (!bundleId) {
    const found = myBundles.find(
      b => b.name === sub.bundle || `${b.createdBy?.name}/${b.name}` === sub.bundle
    );
    bundleId = found?.id;
  }

  if (!bundleId) {
    console.warn(`  Bundle "${sub.bundle}" not found - skipping subscription "${sub.name}"`);
    return;
  }

  try {
    const credentials = sub.credentials
      ? Object.fromEntries(
          Object.entries(sub.credentials).map(([ns, entry]) => [ns, entry.auth])
        )
      : undefined;

    await client.upsertSubscription({
      name: sub.name,
      bundleId,
      credentials,
      router: sub.router,
    });

    console.log(`  Upserted subscription "${sub.name}" -> bundle "${sub.bundle}"`);
  } catch (err: any) {
    const detail = err?.response?.data?.error ?? err.message;
    console.error(`  Failed to sync subscription "${sub.name}": ${detail}`);
  }
}

/**
 * Sync bundle definitions and subscriptions from YAML to the local registry.
 *
 * Three-phase reconciliation:
 *   Phase 1 - MCPs: upsert inline MCP records by namespace (create or update)
 *   Phase 2 - Bundles: find-or-create each bundle, reconcile MCP membership
 *   Phase 3 - Subscriptions: upsert credentials and router config by name
 *
 * Existing access tokens are never modified.
 */
export async function syncCommand(options: SyncOptions): Promise<void> {
  try {
    const config = loadYamlConfig(options.config);

    const hasBundles = config.bundles.length > 0;
    const hasSubs = config.subscriptions.length > 0;

    if (!hasBundles && !hasSubs) {
      console.log("No bundles or subscriptions found in config - nothing to sync.");
      return;
    }

    banner(" Sync ", { bg: BG_COLORS.CYAN });

    if (hasBundles) {
      console.log(`Found ${config.bundles.length} bundle definition(s):`);
      for (const def of config.bundles) {
        reportBundle(def);
        console.log();
      }
    }

    if (hasSubs) {
      console.log(`Found ${config.subscriptions.length} subscription(s):`);
      for (const sub of config.subscriptions) {
        reportSubscription(sub);
      }
      console.log();
    }

    console.log("Existing access tokens are not affected by sync.");
    console.log();

    if (!options.token) {
      console.log("No --token provided - dry run only (no changes pushed).");
      console.log("Pass --token <mcpb_*> to push changes to the registry.");
      return;
    }

    const client = new BundlerAPIClient(options.host, options.token);

    // Phase 0: sync LLM provider bindings (user API key per provider)
    const llmBindings = config.definitions.llm_bindings;
    if (llmBindings.length > 0) {
      console.log(`Phase 0: Syncing ${llmBindings.length} LLM binding(s)...`);
      for (const binding of llmBindings) {
        try {
          await client.upsertLlmBinding(binding.provider, binding.api_key);
          console.log(`  Bound LLM provider "${binding.provider}"`);
        } catch (err: any) {
          const detail = err?.response?.data?.error ?? err.message;
          console.error(`  Failed to bind LLM provider "${binding.provider}": ${detail}`);
        }
      }
      console.log();
    }

    // Phase 1: upsert inline MCPs
    const inlineMcps = collectInlineMcps(config);
    if (inlineMcps.size > 0) {
      console.log(`Phase 1: Upserting ${inlineMcps.size} inline MCP(s)...`);
      for (const [namespace, mcpData] of inlineMcps) {
        await upsertMcpByNamespace(client, namespace, mcpData);
      }
      console.log();
    }

    // Phase 2: sync bundles
    const bundleIdByName = new Map<string, string>();
    let myBundles: BundleResponse[] = [];

    if (hasBundles) {
      console.log(`Phase 2: Syncing ${config.bundles.length} bundle(s)...`);
      myBundles = await client.listMyBundles();

      for (const bundleDef of config.bundles) {
        const bundleId = await syncBundleDef(client, bundleDef, myBundles);
        if (bundleId) bundleIdByName.set(bundleDef.name, bundleId);
        console.log();
      }

      // Refresh after bundle membership changes
      myBundles = await client.listMyBundles();
    }

    // Phase 3: sync subscriptions
    if (hasSubs) {
      if (!hasBundles) {
        myBundles = await client.listMyBundles();
      }

      console.log(`Phase 3: Syncing ${config.subscriptions.length} subscription(s)...`);
      for (const sub of config.subscriptions) {
        await syncSubscription(client, sub, bundleIdByName, myBundles);
      }
      console.log();
    }

    // Remote registry push: for each bundle with sync_to targets, push to each named registry
    const bundlesWithRemoteTargets = config.bundles.filter(
      b => b.sync_to && b.sync_to.length > 0
    );
    if (bundlesWithRemoteTargets.length > 0) {
      console.log(`Remote registry push: ${bundlesWithRemoteTargets.length} bundle(s) have sync_to targets...`);
      for (const bundleDef of bundlesWithRemoteTargets) {
        for (const target of bundleDef.sync_to!) {
          await syncBundleToRegistry(bundleDef, target.registry, config);
        }
      }
      console.log();
    }

    console.log("Sync complete.");

  } catch (error: any) {
    console.error(`Sync failed: ${error.message}`);
    process.exit(1);
  }
}
