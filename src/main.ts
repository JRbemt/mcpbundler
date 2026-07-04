#!/usr/bin/env node

import { config } from "dotenv";
const output = config({
  quiet: true
});

import logger from "./shared/utils/logger.js";

logger.debug(`.ENV initialized: [${Object.keys(output.parsed ?? {}).join(", ")}]`)

import { BundlerConfigSchema } from "./bundler/core/schemas.js";
import { BundlerServer } from "./bundler/core/bundler.js";
import { APIBundleResolver } from "./bundler/core/resolver/api-bundle-resolver.js";
import { YamlBundleResolver } from "./bundler/core/resolver/yaml-bundle-resolver.js";
import { loadYamlConfig, buildEnvForConfig } from "./bundler/core/resolver/yaml-config-loader.js";

const CONFIG = {
  bundler: {
    name: "MCP Bundler",
    version: "0.1.0",
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "3000", 10),
    concurrency: {
      max_concurrent: 100,
      idle_timeout_ms: 20 * 60 * 1000,
    }
  },
}

export async function main() {
  try {
    const validatedConfig = BundlerConfigSchema.parse(CONFIG.bundler);

    const backendUrl = process.env.BACKEND_URL?.trimEnd().replace(/\/$/, "");
    const yamlConfig = process.env.YAML_CONFIG;

    let resolver;

    if (backendUrl) {
      logger.info({ backendUrl }, "Using APIBundleResolver - delegating bundle resolution to backend");
      resolver = new APIBundleResolver(backendUrl);
    } else if (yamlConfig) {
      logger.info({ yamlConfig }, "Using YamlBundleResolver - YAML config mode");
      const config = loadYamlConfig(yamlConfig, buildEnvForConfig(yamlConfig));
      resolver = new YamlBundleResolver(config);
    } else {
      logger.error("No resolver configured. Set BACKEND_URL for API mode or YAML_CONFIG for YAML mode.");
      process.exit(1);
    }

    const bundlerServer = new BundlerServer(validatedConfig, resolver);

    const { shutdown: shutdownFn } = await bundlerServer.start();

    const handleShutdown = async (signal: string) => {
      logger.info({ signal }, "Received shutdown signal");
      try {
        await shutdownFn();
        logger.info({ msg: "Server shutdown completed successfully" });
        process.exit(0);
      } catch (error) {
        logger.error({ error }, "Error during shutdown");
        process.exit(1);
      }
    };

    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));

    process.on("uncaughtException", (error) => {
      logger.error({ error }, "Uncaught exception");
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error({ reason, promise }, "Unhandled promise rejection");
      process.exit(1);
    });

    logger.info({
      msg: "Server startup complete, ready to accept connections",
      pid: process.pid
    });

  } catch (error) {
    if (error instanceof Error) {
      logger.error({ error: error.message }, "Failed to start server");
    } else {
      logger.error({ error: String(error) }, "Failed to start server");
    }
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ error }, "Unhandled error in main");
  process.exit(1);
});
