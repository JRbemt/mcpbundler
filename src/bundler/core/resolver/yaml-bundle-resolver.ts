import { Bundle, MCPConfig } from "../schemas.js";
import { ResolverService } from "./service.js";
import {
    YamlBundleMcpEntry,
    YamlConfig,
    YamlDefinitions,
} from "./yaml-config-loader.js";
import logger from "../../../shared/utils/logger.js";
import { MCPAuthConfig } from "../../../shared/domain/entities.js";
import { McpPermissions } from "../../../shared/domain/entities.js";

type ResolvedMcp = {
    namespace: string;
    url: string;
    stateless: boolean;
    authStrategy: "MASTER" | "USER_SET" | "NONE";
    auth?: MCPAuthConfig;
    description?: string;
    capabilities?: string[];
};

/**
 * Resolves a bundle MCP entry to a concrete definition.
 * Registry refs cannot be resolved without an external catalog and are skipped.
 * Local refs are looked up in definitions.mcps by namespace.
 */
function resolveEntry(entry: YamlBundleMcpEntry, definitions: YamlDefinitions): ResolvedMcp | null {
    if ("ref" in entry) {
        const def = definitions.mcps.find(m => m.namespace === entry.ref);
        if (!def) {
            logger.warn({ ref: entry.ref }, "Local ref not found in definitions - skipping MCP");
            return null;
        }
        if (!("url" in def)) {
            logger.warn({ namespace: def.namespace }, "Definition is an external registry ref - cannot resolve in YAML mode, skipping");
            return null;
        }
        return {
            namespace: def.namespace,
            url: def.url,
            stateless: def.stateless,
            authStrategy: entry.auth_strategy,
            auth: def.auth,
            description: def.description,
            capabilities: def.capabilities,
        };
    }

    if ("registry" in entry) {
        logger.warn({ namespace: entry.namespace, registry: entry.registry }, "Registry ref cannot be resolved in YAML mode - skipping MCP");
        return null;
    }

    return {
        namespace: entry.namespace,
        url: entry.url,
        stateless: entry.stateless,
        authStrategy: entry.auth_strategy,
        auth: entry.auth,
        description: entry.description,
        capabilities: entry.capabilities,
    };
}

export class YamlBundleResolver implements ResolverService {
    private readonly config: YamlConfig;

    constructor(config: YamlConfig) {
        this.config = config;
        logger.info(
            { bundles: config.bundles.length, subscriptions: config.subscriptions.length },
            "YamlBundleResolver initialized"
        );
    }

    async resolveBundle(token: string): Promise<Bundle> {
        const subscription = this.config.subscriptions.find(s =>
            Object.values(s.tokens).includes(token)
        );
        if (!subscription) {
            throw Object.assign(new Error("Invalid bundle token"), { status: 401 });
        }

        const bundleDef = this.config.bundles.find(b => b.name === subscription.bundle);
        if (!bundleDef) {
            throw Object.assign(
                new Error(`Bundle "${subscription.bundle}" referenced by subscription "${subscription.name}" not found in YAML config`),
                { status: 404 }
            );
        }

        const upstreams: MCPConfig[] = [];

        for (const entry of bundleDef.mcps) {
            const resolved = resolveEntry(entry, this.config.definitions);
            if (!resolved) continue;

            let auth: MCPAuthConfig | undefined;
            let permissions: McpPermissions | undefined;

            if (resolved.authStrategy === "USER_SET") {
                const credential = subscription.credentials?.[resolved.namespace];
                if (!credential) {
                    logger.warn(
                        { namespace: resolved.namespace, subscription: subscription.name },
                        "USER_SET MCP has no credential in subscription - skipping"
                    );
                    continue;
                }
                auth = credential.auth;
                permissions = credential.permissions as McpPermissions | undefined;
            } else if (resolved.authStrategy === "MASTER") {
                auth = resolved.auth;
            }

            upstreams.push({
                namespace: resolved.namespace,
                url: resolved.url,
                stateless: resolved.stateless,
                authStrategy: resolved.authStrategy,
                auth,
                description: resolved.description,
                capabilities: resolved.capabilities,
                permissions,
            });
        }

        return {
            bundleId: `yaml:${subscription.name}`,
            name: bundleDef.name,
            upstreams,
            router: subscription.router,
        };
    }
}
