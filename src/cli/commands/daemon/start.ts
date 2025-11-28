import logger from "../../../utils/logger.js";
import { startDaemon, getDaemonStatus, getLogPaths } from "./daemon.js";

interface StartOptions {
  port?: string;
  database?: string;
  daemon: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const port = parseInt(options.port || "3000", 10);

  // Check if already running
  const status = await getDaemonStatus();
  if (status.running) {
    logger.error(`MCP Bundler server already running [PID ${status.pid}, Port ${status.port}]`);
    logger.info(`Use "mcpbundler server stop" to terminate the running instance`);
    process.exit(1);
  }

  if (options.daemon) {
    // Start as daemon
    try {
      const newStatus = await startDaemon(port, options.database);
      logger.info(`MCP Bundler server started successfully`);
      logger.info(`Process ID: ${newStatus.pid}`);
      logger.info(`Listening on port ${newStatus.port}`);
      logger.info(`Service endpoint: http://localhost:${newStatus.port}`);

      const logPaths = getLogPaths();
      logger.info(`Log files: ${logPaths.stdout}`);

      logger.info(`Management: pm2 [logs|monit|restart] mcpbundler`);
      logger.info(`Status check: mcpbundler server status`);

      // Exit successfully after starting daemon
      process.exit(0);
    } catch (error) {
      logger.error({ error }, "Failed to start server");
      process.exit(1);
    }
  } else {
    // Start in foreground
    logger.info(`Starting MCP Bundler in foreground mode`);
    logger.info(`Configuration: port=${port}${options.database ? `, database=${options.database}` : ""}`);

    // Set environment variables
    process.env.PORT = port.toString();
    if (options.database) {
      process.env.DATABASE_URL = options.database;
    }

    try {
      const mainModule = await import("../../../main.js");
    } catch (error) {
      logger.error({ error }, "Failed to start server");
      process.exit(1);
    }
  }
}
