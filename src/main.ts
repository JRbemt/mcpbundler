#!/usr/bin/env node

/**
 * Main entry point for the MCP Bundler server
 *
 * This file demonstrates how a manager system would start the server
 * by providing a parsed BundlerConfig object to the startServer function.
 */

// Load environment variables from .env file
// CLI-provided env vars (via PM2) will override these defaults
import logger from "./utils/logger.js";
import { config } from 'dotenv';
const output = config({
  quiet: true
});
logger.info(`.ENV initialized: [${Object.keys(output.parsed ?? {}).join(", ")}]`)

import { BundlerConfigSchema } from "./config/schemas.js";
import { BundlerServer } from "./core/server.js";
import { CollectionAuthService } from "./services/auth/collection-auth.js";
import { PrismaClient } from "@prisma/client";

/**
 * Main execution function
 */
async function main() {
  try {
    logger.info('Initializing database connection');
    let databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL environment variable is required. Set it in .env file.");
    }

    let databaseType: "sqlite" | "postgres";
    if (databaseUrl.startsWith('file:')) {
      databaseType = "sqlite";
    } else if (databaseUrl.startsWith('postgresql:')) {
      databaseType = "postgres";
    } else {
      throw Error(`Unsupported DATABASE_URL format, suports: [sqlite, postgres]`);
    }

    // Create PrismaClient with explicit datasource URL
    const prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });

    // Apply SQLite optimizations for better concurrency
    if (databaseType === 'sqlite') {
      await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
      await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
      logger.info('SQLite configured with WAL mode');
    }

    logger.info({ databaseType, databaseUrl }, 'Database initialized successfully');

    const managerProvidedConfig = {
      name: "MCP Bundler",
      version: "0.1.0",
      host: "0.0.0.0",
      port: parseInt(process.env.PORT || '3000', 10),
      concurrency: {
        max_sessions: 100,
        startup_block_ms: 100
      },

      // Optional manager integration fields
      manager: {
        instance_id: `bundler-${Date.now()}`,
        // manager_endpoint: "http://localhost:8080/api/v1/bundlers",
      },

      // Backend configuration
      backend: {
        base_url: process.env.BACKEND_URL || "http://localhost:8000",
      },

      // Metering configuration
      metering: {
        enabled: false,
        service_token: process.env.BUNDLER_SERVICE_TOKEN,
        flush_interval_ms: 10000,
        batch_size: 100,
      }
    };

    logger.info({ config: managerProvidedConfig }, "Starting server with configuration");

    // Parse and validate the configuration using Zod schema
    const validatedConfig = BundlerConfigSchema.parse(managerProvidedConfig);

    // Initialize services with database dependency
    const authService = new CollectionAuthService(prisma);

    const bundlerServer = new BundlerServer(validatedConfig, authService, prisma);
    const { httpServer, mcpServer, shutdown: shutdownFn } = await bundlerServer.start();

    // Setup graceful shutdown handlers
    const handleShutdown = async (signal: string) => {
      logger.info({ signal }, "Received shutdown signal");
      try {
        await shutdownFn();
        logger.info('Disconnecting from database');
        await prisma.$disconnect();
        logger.info({ msg: "Server shutdown completed successfully" });
        process.exit(0);
      } catch (error) {
        logger.error({ error }, "Error during shutdown");
        process.exit(1);
      }
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));

    // Handle uncaught exceptions and unhandled rejections
    process.on('uncaughtException', (error) => {
      logger.error({ error }, "Uncaught exception");
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error({ reason, promise }, "Unhandled promise rejection");
      process.exit(1);
    });

    logger.info({
      msg: 'Server startup complete, ready to accept connections',
      instanceId: validatedConfig.manager?.instance_id,
      pid: process.pid
    });

    // Optional: Report to manager system that server is ready
    if (validatedConfig.manager?.manager_endpoint) {
      logger.info({
        managerEndpoint: validatedConfig.manager.manager_endpoint
      }, "Manager endpoint configured - health reporting could be implemented here");
    }

  } catch (error) {
    console.log(error);
    logger.error({ error }, "Failed to start server");
    process.exit(1);
  }
}

// Start the server
main().catch((error) => {
  logger.error({ error }, "Unhandled error in main");
  process.exit(1);
});