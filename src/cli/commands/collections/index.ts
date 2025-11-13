/**
 * MCPs and Collections Command Groups
 *
 * HTTP API client commands for managing collections and MCP servers
 */

import { Command } from 'commander';
import { listCollectionsCommand } from './list.js';
import { createCollectionCommand } from './create.js';
import { getTokenCommand } from './get-token.js';


export function createCollectionsCommand(): Command {
  const command = new Command('collections');
  command.description('Manage collections');

  command
    .command('list')
    .description('List all collections')
    .option('--host [host]', 'Bundler server URL', 'http://127.0.0.1:3000')
    .option('--token [token]', 'Auth token (optional)')
    .action(listCollectionsCommand);

  command
    .command('create <name>')
    .description('Create a new collection')
    .option('--host [host]', 'Bundler server URL', 'http://127.0.0.1:3000')
    .option('--token [token]', 'Auth token (required for write operations)')
    .action(createCollectionCommand);

  command
    .command('token <collection-id>')
    .description('Generate access token for a collection')
    .option('--host [host]', 'Bundler server URL', 'http://127.0.0.1:3000')
    .option('--token [token]', 'Auth token (required for admin operations)')
    .action(getTokenCommand);

  return command;
}
