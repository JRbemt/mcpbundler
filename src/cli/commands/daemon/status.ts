import { getDaemonStatus, getLogPaths } from "./daemon.js";
import { BundlerAPIClient } from "../../utils/api-client.js";
import logger from "../../../utils/logger.js";

export async function statusCommand(): Promise<void> {
  const status = await getDaemonStatus();

  if (!status.running) {
    logger.info("MCP Bundler server: NOT RUNNING");
    logger.info("Start with: mcpbundler server start");
    process.exit(0);
  }

  logger.info("MCP Bundler server: RUNNING");
  logger.info(`Process ID: ${status.pid}`);
  logger.info(`Service port: ${status.port}`);
  logger.info(`Endpoint: http://0.0.0.0:${status.port}`);

  // Try to get metrics from the server
  try {
    const client = new BundlerAPIClient(`http://0.0.0.0:${status.port}`);
    const metrics = await client.getMetrics();

    logger.info(`Active sessions: ${metrics.sessions?.active || 0}/${metrics.sessions?.max || "N/A"}`);
    logger.info(`Configured upstreams: ${metrics.upstreams?.length || 0}`);

    if (metrics.upstreams && metrics.upstreams.length > 0) {
      metrics.upstreams.forEach((upstream: any) => {
        const status = upstream.connected ? "CONNECTED" : "DISCONNECTED";
        logger.info(`  ${upstream.namespace}: ${status}`);
      });
    }
  } catch (error) {
    logger.warn("Unable to fetch metrics - server may be starting up");
  }

  const logPaths = getLogPaths();
  logger.info(`Logs: ${logPaths.stdout}`);
  logger.info(`Management: pm2 [logs|monit|restart] mcpbundler`);

  process.exit(0);
}
