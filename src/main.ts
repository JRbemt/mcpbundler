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
import { DBBundleResolver } from "./bundler/core/bundle-resolver.js";
import { PrismaClient, PermissionType } from "@prisma/client";
import { createBundleRoutes } from "./api/routes/bundles.js";
import { createCredentialRoutes } from "./api/routes/credentials.js";
import { createMcpRoutes } from "./api/routes/mcps.js";
import { createUserRoutes } from "./api/routes/users.js";
import { createPermissionRoutes } from "./api/routes/permissions.js";
import { createAuthMiddleware } from "./api/middleware/auth.js";
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
    let databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is required. Set it in .env file.");
    }

    // Parse and validate the configuration using Zod schema
    const validatedConfig = BundlerConfigSchema.parse(CONFIG.bundler);

    // Create PrismaClient with explicit datasource URL
    const prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });

    const resolver = new DBBundleResolver(prisma, CONFIG.resolver.wildcard);
    const bundlerServer = new BundlerServer(validatedConfig, resolver);

    // Apply SQLite optimizations for better concurrency
    const isSqlite = databaseUrl.startsWith("file:");
    if (isSqlite) {
      await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;");
      await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000;");
    }

    // Initialize system data (root user and global settings)
    const systemConfig = buildSystemInitConfig();
    await initializeSystemData(prisma, systemConfig);

    // Mount management API routes BEFORE starting the HTTP server
    const app = bundlerServer.getApp();
    const authMiddleware = createAuthMiddleware(prisma);

    const apiRouter = express.Router();
    apiRouter.use(express.json());
    // Add request logging middleware for debugging
    apiRouter.use((req, res, next) => {
      logger.debug({ method: req.method, path: req.path, url: req.url }, 'Incoming request');
      next();
    });

    apiRouter.use("/bundles", authMiddleware, createBundleRoutes(prisma));
    apiRouter.use("/credentials", createCredentialRoutes(prisma));
    apiRouter.use("/mcps", authMiddleware, createMcpRoutes(prisma));
    apiRouter.use("/users", createUserRoutes(authMiddleware, prisma));
    apiRouter.use("/permissions", createPermissionRoutes(authMiddleware, prisma));
    app.use("/api", apiRouter);

    // Start the HTTP server after all routes are mounted
    const { shutdown: shutdownFn } = await bundlerServer.start();

    // Setup graceful shutdown handlers
    const handleShutdown = async (signal: string) => {
      logger.info({ signal }, "Received shutdown signal");
      try {
        await shutdownFn();
        logger.info("Disconnecting from database");
        await prisma.$disconnect();
        logger.info({ msg: "Server shutdown completed successfully" });
        process.exit(0);
      } catch (error) {
        logger.error({ error }, "Error during shutdown");
        process.exit(1);
      }
    };

    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));

    // Handle uncaught exceptions and unhandled rejections
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

