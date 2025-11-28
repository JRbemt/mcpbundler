/**
 * Client Connect Command
 *
 * Connects to an mcpbundler server via SSE and exposes it as a STDIO MCP server.
 * This allows standard MCP clients (like Claude Desktop) to use bundled servers.
 *
 * Usage:
 *   mcpbundler client --url http://localhost:3000 --token <your-token>
 *
 * Claude Desktop config example:
 * {
 *   "mcpServers": {
 *     "bundler": {
 *       "command": "mcpbundler",
 *       "args": ["client", "--url", "http://localhost:3000", "--token", "your-token-here"]
 *     }
 *   }
 * }
 */

import { StdioToSseBridge } from "./bridge/stdio-bridge.js";
import logger from "../../../utils/logger.js";

interface ClientConnectOptions {
  name: string;
  host: string;
  collection?: string;
}

export async function clientConnectCommand(options: ClientConnectOptions): Promise<void> {
  try {
    // Validate URL
    let bundlerUrl: URL;
    try {
      bundlerUrl = new URL(options.host);
    } catch (error) {
      logger.error({ url: options.host }, "Invalid bundler URL");
      process.exit(1);
    }

    // Create and start bridge
    const bridge = new StdioToSseBridge({
      bundlerUrl: bundlerUrl.origin,
      token: options.collection,
      serverInfo: { name: options.name, version: "1.0.0" }
    });

    // Setup graceful shutdown handlers
    const shutdown = async () => {
      logger.info("Received shutdown signal");
      try {
        await bridge.shutdown();
        process.exit(0);
      } catch (error) {
        logger.error({ error }, "Error during shutdown");
        process.exit(1);
      }
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Handle unexpected errors
    process.on("uncaughtException", (error) => {
      logger.error({ error }, "Uncaught exception");
      process.exit(1);
    });

    process.on("unhandledRejection", (reason) => {
      logger.error({ reason }, "Unhandled promise rejection");
      process.exit(1);
    });

    // Start the bridge
    logger.debug({ bundlerUrl: bundlerUrl.origin }, "Starting STDIO-to-SSE bridge");
    await bridge.start();

    // Bridge is now running and will handle STDIO communication
    // Process will stay alive until SIGINT/SIGTERM
    logger.debug("Bridge is running, waiting for MCP requests on STDIO");

  } catch (error) {
    logger.error({ error }, "Failed to start client");
    process.exit(1);
  }
}
