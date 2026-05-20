/**
 * YAML Bundle Resolver
 *
 * Startup hook for YAML-mode deployments. Registers LLM providers declared
 * in definitions.llms into the global LLM registry so they are available
 * to the tool router middleware.
 *
 * Token resolution is not supported in this resolver — bundles and subscriptions
 * are registry-managed. Use `mcpbundler sync` to push definitions and
 * `mcpbundler token <name>` to generate access tokens. For token resolution
 * use DB mode (DATABASE_URL) or API mode (BACKEND_URL).
 */

import { Bundle } from "../schemas.js";
import { ResolverService } from "./service.js";
import { YamlConfig } from "./yaml-config-loader.js";
import logger from "../../../shared/utils/logger.js";

export class YamlBundleResolver implements ResolverService {
  constructor(config: YamlConfig) {
    if (config.bundles.length > 0) {
      logger.warn(
        { bundleCount: config.bundles.length },
        "YAML config contains bundle definitions - run \"mcpbundler sync\" to push them to a registry"
      );
    }

    if (config.subscriptions.length > 0) {
      logger.warn(
        { subscriptionCount: config.subscriptions.length },
        "YAML config contains subscriptions - run \"mcpbundler token <name>\" to generate access tokens"
      );
    }

    logger.info("YamlBundleResolver initialized (token resolution requires DB or API mode)");
  }

  async resolveBundle(_token: string): Promise<Bundle> {
    throw Object.assign(
      new Error("Token resolution is not supported in YAML mode. Use DB mode (DATABASE_URL) or API mode (BACKEND_URL)."),
      { status: 501 }
    );
  }
}
