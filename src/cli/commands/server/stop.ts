import logger from '../../../utils/logger.js';
import { stopDaemon, getDaemonStatus } from '../../utils/daemon.js';

export async function stopCommand(): Promise<void> {
  const status = await getDaemonStatus();

  if (!status.running) {
    logger.info('MCP Bundler server is not running');
    process.exit(0);
  }

  logger.info(`Stopping MCP Bundler server [PID ${status.pid}]`);

  const stopped = await stopDaemon();

  if (stopped) {
    logger.info('Server stopped successfully');
    process.exit(0);
  } else {
    logger.error('Failed to stop server - check PM2 status with: pm2 list');
    process.exit(1);
  }
}
