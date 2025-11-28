/**
 * Client Command Group
 *
 * Commands for connecting to mcpbundler server as an MCP client
 */

import { Command } from "commander";
import { clientConnectCommand } from "./connect.js";
import { HELP_FOOTER } from "../../utils/print-utils.js";

export function createClientCommand(): Command {
  const command = new Command("client")
    .description("connect to mcpbundler server")
    .showHelpAfterError()
    .showSuggestionAfterError();

  const connect = command.command("connect")
    .description("expose bundler as an STDIO Server for local LLM integration")
    .option("--name [name]", "Server name", "mcpbundler-client")
    .option("--host [host]", "API host", "http://0.0.0.0:3000")
    .option("-c, --collection [token]", "Access token for the collection on the bundler server")
    .action(clientConnectCommand);

  command.addHelpText("after", HELP_FOOTER)
  return command;
}
