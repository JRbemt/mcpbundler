#!/usr/bin/env node

/**
 * Main entry point for this MCP Bundler server application
 * Sets up environment, database, and starts the server.
 *
 * This implementation builds also a management API for bundles and tokens.
 * If you want just the bundler, consider using `src/core/bundler.ts` instead (with a custom bundle resolver implementation).
 */

import { config } from "dotenv";
const output = config({
  quiet: true
});

logger.debug(`.ENV initialized: [${Object.keys(output.parsed ?? {}).join(", ")}]`)

import express from "express";
import { BundlerConfigSchema } from "./bundler/core/schemas.js";
import { BundlerServer } from "./bundler/core/bundler.js";
import { DBBundleResolver } from "./bundler/core/resolver/db-resolver.js";
import { APIBundleResolver } from "./bundler/core/resolver/api-bundle-resolver.js";
import { PrismaClient } from "./shared/domain/entities.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { createBundleRoutes } from "./api/routes/bundles.js";
import { createMcpRoutes } from "./api/routes/mcps.js";
import { createUserRoutes } from "./api/routes/users.js";
import { createPermissionRoutes } from "./api/routes/permissions.js";
import { createSubscriptionRoutes } from "./api/routes/subscriptions.js";
import { createLlmProviderRoutes } from "./api/routes/llm-providers.js";
import { LlmProviderRepository } from "./shared/infra/repository/index.js";
import { createAuthMiddleware } from "./api/middleware/auth.js";
import { generateOpenApiSpec } from "./api/openapi.js";
import swaggerUi from "swagger-ui-express";
import { initializeSystemData, parsePermissions, SystemInitConfig } from "./shared/utils/initialize-db.js";
import logger from "./shared/utils/logger.js";
import { validateEncryptionKey } from "./shared/utils/encryption.js";


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
  resolver: {
    wildcard: {
      allow_wildcard_token: process.env.RESOLVER_WILDCARD_ALLOW === "true",
      wildcard_token: process.env.RESOLVER_WILDCARD_TOKEN || "",
    }
  }
}

/**
 * Build system initialization config from environment variables
 */
function buildSystemInitConfig(): SystemInitConfig {
  return {
    rootUser: {
      name: process.env.ROOT_USER_NAME || "Root Administrator",
      email: process.env.ROOT_USER_EMAIL || "admin@example.com"
    },
    selfService: {
      enabled: process.env.SELF_SERVICE_ENABLED === "true",
      defaultPermissions: parsePermissions(process.env.SELF_SERVICE_DEFAULT_PERMISSIONS)
    }
  };
}

if (CONFIG.resolver.wildcard.allow_wildcard_token) {
  if (CONFIG.resolver.wildcard.wildcard_token === undefined) {
    logger.error("RESOLVER_WILDCARD_ALLOW is true but RESOLVER_WILDCARD_TOKEN is not set");
    throw new Error("Wildcard token must be configured when RESOLVER_WILDCARD_ALLOW is enabled");
  }
  logger.warn(`Wildcard token is enabled - this grants unrestricted access to all pre-authenticated (auth-strategy=MASTER|NONE) MCPs with a single token`);
  logger.info(`Bundle-Wildcard-Token:\"${CONFIG.resolver.wildcard.wildcard_token}\"`)
}

/**
 * Main execution function
 */
export async function main() {
  try {
    const validatedConfig = BundlerConfigSchema.parse(CONFIG.bundler);

    const backendUrl = process.env.BACKEND_URL?.trimEnd().replace(/\/$/, "");

    let resolver;
    let prisma: PrismaClient | undefined;

    if (backendUrl) {
      logger.info({ backendUrl }, "Using APIBundleResolver - delegating bundle resolution to backend");
      resolver = new APIBundleResolver(backendUrl);
    } else {
      // DB mode = requires ENCRYPTION_KEY and DATABASE_URL
      logger.info("Validating encryption key configuration");
      const isProduction = process.env.NODE_ENV === "production";

      if (!validateEncryptionKey()) {
        if (isProduction) {
          logger.error("ENCRYPTION_KEY validation failed in production environment. Exiting.");
          process.exit(1);
        } else {
          logger.warn("ENCRYPTION_KEY validation failed. Continuing in development mode, but this is INSECURE!");
        }
      }

      logger.info("Initializing database connection");
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error("DATABASE_URL environment variable is required. Set it in .env file.");
      }

      const adapter = new PrismaPg({ connectionString: databaseUrl });
      prisma = new PrismaClient({ adapter } as any);

      logger.info("Using DBBundleResolver - standalone mode");
      resolver = new DBBundleResolver(prisma, CONFIG.resolver.wildcard);
    }

    const bundlerServer = new BundlerServer(validatedConfig, resolver);
    const app = bundlerServer.getApp();

    // Mount management API in DB mode only
    if (!backendUrl && prisma) {
      const systemConfig = buildSystemInitConfig();
      await initializeSystemData(prisma, systemConfig);

      const llmRepo = new LlmProviderRepository(prisma);
      await llmRepo.seed([
        {
          name: "claude",
          model: "claude-3-5-haiku-latest",
          endpoint: "https://api.anthropic.com/v1",
          description: "Anthropic Claude 3.5 Haiku"
        },
        {
          name: "chatgpt",
          model: "gpt-4o-mini",
          endpoint: "https://api.openai.com/v1",
          description: "OpenAI ChatGPT"
        },
        {
          name: "gemini",
          model: "gemini-2.5-flash",
          endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
          description: "Google Gemini 2.5 Flash"
        },
        {
          name: "gemini-pro",
          model: "gemini-2.5-pro",
          endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
          description: "Google Gemini 2.5 Pro"
        },
      ]);

      const authMiddleware = createAuthMiddleware(prisma);
      const apiRouter = express.Router();
      apiRouter.use(express.json());
      apiRouter.use((req, res, next) => {
        logger.debug({ method: req.method, path: req.path, url: req.url }, "Incoming request");
        next();
      });

      apiRouter.use("/bundles", authMiddleware, createBundleRoutes(prisma));
      apiRouter.use("/mcps", authMiddleware, createMcpRoutes(prisma));
      apiRouter.use("/users", createUserRoutes(authMiddleware, prisma));
      apiRouter.use("/permissions", createPermissionRoutes(authMiddleware, prisma));
      apiRouter.use("/subscriptions", authMiddleware, createSubscriptionRoutes(prisma));
      apiRouter.use(authMiddleware, createLlmProviderRoutes(prisma));

      const spec = generateOpenApiSpec();
      app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));
      app.get("/api/openapi.json", (_req, res) => res.json(spec));

      app.use("/api", apiRouter);
      logger.info("Management API mounted at /api");
      logger.info("API docs available at /api/docs");
    } else if (backendUrl) {
      logger.info("Management API disabled - backend integration active");
    }

    // Start the HTTP server after all routes are mounted
    const { shutdown: shutdownFn } = await bundlerServer.start();

    // Setup graceful shutdown handlers
    const handleShutdown = async (signal: string) => {
      logger.info({ signal }, "Received shutdown signal");
      try {
        await shutdownFn();
        if (prisma) {
          logger.info("Disconnecting from database");
          await prisma.$disconnect();
        }
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

// Start the server
main().catch((error) => {
  logger.error({ error }, "Unhandled error in main");
  process.exit(1);
});
