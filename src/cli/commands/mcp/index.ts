/**
 * MCPs and Collections Command Groups
 *
 * HTTP API client commands for managing collections and MCP servers
 */

import { Command } from 'commander';
import { addCommand, addManualCommand } from './add.js';
import { removeCommand } from './remove.js';
import { listCommand } from './list.js';

export function createMcpsCommand(): Command {
  const command = new Command('mcp');
  command.description('Manage MCP servers');

  const add = command
    .command('add <package-spec>')
    .description('Add an MCP server to a collection from registry [not yet supported]')
    .option('--host [host]', 'Bundler server URL (optional)', 'http://127.0.0.1:3000')
    .option('--token [token]', 'Auth token (optional)')
    .action(addCommand);

  add.command('manual')
    .description('Add an MCP server manually via URL and metadata')
    .option('-n, --namespace <namespace>', 'Namespace for the MCP')
    .option('--url <url>', 'URL of the MCP server')
    .option('--author <author>', 'Author of the MCP server (required for direct URLs)')
    .option('--description [description]', 'Description of the MCP server (required if no description-file)')
    .option('--description-file [path]', 'Path to file containing MCP description')
    .option('--version [version]', 'Version of the MCP server', '1.0.0')
    .option('--stateless', 'Mark as stateless (shared connection)', false)
    .option('--auth-bearer [token]', 'Bearer token authentication (optional)')
    .option('--auth-basic [user:pass]', 'Basic authentication username:password (optional)')
    .option('--auth-apikey [key]', 'API key authentication (optional)')
    .option('--host [host]', 'Bundler server URL (optional)', 'http://127.0.0.1:3000')
    .option('--token [token]', 'Auth token (optional)')
    .action(addManualCommand);

  command
    .command('remove <namespace>')
    .description('Remove an MCP server by namespace')
    .option('--host [host]', 'Bundler server URL', 'http://127.0.0.1:3000')
    .option('--token [token]', 'Auth token (required for write operations)')
    .action(removeCommand);

  command
    .command('list')
    .description('List all configured MCP servers')
    .option('--host [host]', 'Bundler server URL', 'http://127.0.0.1:3000')
    .option('--token [token]', 'Auth token (optional)')
    .action(listCommand);

  return command;
}