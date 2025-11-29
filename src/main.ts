#!/usr/bin/env node

/**
 * Main entry point for this MCP Bundler server application
 * Sets up environment, database, and starts the server. 
 * 
 * This implementation builds also a management API for collections and tokens.
 * If you want just the bundler, consider using `src/core/bundler.ts` instead (with a custom CollectionResolver implementation).
 */

import { config } from "dotenv";
const output = config({
  quiet: true
});

import logger from "./utils/logger.js";
logger.debug(`.ENV initialized: [${Object.keys(output.parsed ?? {}).join(", ")}]`)

import express from "express";
import { BundlerConfigSchema } from "./core/config/schemas.js";
import { BundlerServer } from "./core/bundler.js";
import { CollectionResolver } from "./core/collection-resolver.js";
import { PrismaClient, PermissionType } from "@prisma/client";
import { createCollectionRoutes } from "./api/routes/collections.js";
import { createTokenRoutes } from "./api/routes/tokens.js";
import { createMcpRoutes } from "./api/routes/mcps.js";
import { createUserRoutes } from "./api/routes/users.js";
import { createPermissionRoutes } from "./api/routes/permissions.js";
import { validateEncryptionKey } from "./utils/encryption.js";
import { createAuthMiddleware } from "./api/middleware/auth.js";
import { initializeSystemData, SystemInitConfig } from "./utils/initialize-system.js";


const CONFIG = {
  bundler: {
    name: "MCP Bundler",
    version: "0.1.0",
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "3000", 10),
    concurrency: {
      max_sessions: 100,
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
 * Parse comma-separated permission types from environment variable
 */
function parsePermissions(value: string | undefined): PermissionType[] {
  if (!value || value.trim() === "") {
    return [];
  }

  const parts = value.split(",").map(p => p.trim()).filter(p => p !== "");
  const validPermissions: PermissionType[] = [];
  const invalidPermissions: string[] = [];

  const validPermissionValues = Object.values(PermissionType);

  logger.info(validPermissionValues)
  for (const part of parts) {
    if (validPermissionValues.includes(part as PermissionType)) {
      validPermissions.push(part as PermissionType);
    } else {
      invalidPermissions.push(part);
    }
  }

  if (invalidPermissions.length > 0) {
    logger.error({ invalidPermissions }, `Invalid permissions in SELF_SERVICE_DEFAULT_PERMISSIONS: ${invalidPermissions}`);
    throw new Error(`Invalid permissions in SELF_SERVICE_DEFAULT_PERMISSIONS: ${invalidPermissions}`);
  }

  return validPermissions;
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
  logger.info(`Collection-Wildcard-Token:\"${CONFIG.resolver.wildcard.wildcard_token}\"`)
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

    const resolver = new CollectionResolver(prisma, CONFIG.resolver.wildcard);
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

    // Mount routes in correct order
    // User routes FIRST (they handle auth internally for /self endpoint)
    apiRouter.use("/users", authMiddleware, createUserRoutes(prisma));
    apiRouter.use("/collections", authMiddleware, createCollectionRoutes(prisma));
    apiRouter.use("/tokens", authMiddleware, createTokenRoutes(prisma));
    apiRouter.use("/mcps", authMiddleware, createMcpRoutes(prisma));
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