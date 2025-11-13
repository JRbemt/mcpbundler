/**
 * Client Command Group
 *
 * Commands for connecting to mcpbundler server as an MCP client
 */

import { Command } from 'commander';
import { clientConnectCommand } from './connect.js';

export function createClientCommand(): Command {
  const command = new Command('client')
    .description('Connect to mcpbundler server and expose as MCP STDIO server');

  const connect = command.command("connect")
    .description("Connect to mcpbundler server and expose as STDIO MCP server")
    .requiredOption("--host <host>", "Bundler server URL (e.g., http://localhost:3000)")
    .requiredOption("--token <token>", "Authentication token for the bundler")
    .option("--name <name>", "Server name (default: mcpbundler-client)")
    .action(clientConnectCommand);

  return command;
}
