/**
 * Server Command Group
 *
 * Manages the MCP bundler server lifecycle (start, stop, status)
 */

import { Command } from 'commander';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';

export function createServerCommand(): Command {
  const command = new Command('server');

  command.description('Manage the MCP bundler server');

  // Start command
  command
    .command('start')
    .description('Start the MCP bundler server')
    .option('-p, --port <port>', 'Port to run on', '3000')
    .option('-d, --database <url>', 'Database connection URL')
    .option('--no-daemon', 'Run in foreground instead of as daemon')
    .action(startCommand);

  // Stop command
  command
    .command('stop')
    .description('Stop the MCP bundler server')
    .action(stopCommand);

  // Status command
  command
    .command('status')
    .description('Check server status')
    .action(statusCommand);

  return command;
}
