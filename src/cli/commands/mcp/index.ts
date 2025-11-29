/**
 * MCPs and Collections Command Groups
 *
 * HTTP API client commands for managing collections and MCP servers
 */

import { Command, Option } from "commander";
import { addMcpCommand } from "./add.js";
import { removeMcpCommand } from "./remove.js";
import { listMcpCommand } from "./list.js";
import { HELP_FOOTER } from "../../utils/print-utils.js";

export function createMcpsCommand(): Command {
  const command = new Command("mcp");
  command.description("manage MCPs")
    .showHelpAfterError()
    .showSuggestionAfterError();

  command.command("add")
    .description("add an MCP server manually via URL and metadata (requires valid token, ADD_MCP permission)")
    .requiredOption("-n, --namespace <namespace>", "Namespace for the MCP")
    .requiredOption("--url <url>", "URL of the MCP server")
    .requiredOption("--author <author>", "Author of the MCP server")
    .requiredOption("--description <description>", "Description of the MCP server")
    .option("-v, --mcp-version [version]", "Version of the MCP server", "1.0.0")
    .option("--stateless", "Mark as stateless (shared connection)", false)
    .addOption(new Option("--auth-type <type>", "Which auth credentials are used by collections accessing the MCP").choices(["MASTER", "NONE", "TOKEN_SPECIFIC"]).default("NONE"))
    .option("--auth-bearer [token]", "Bearer token authentication (optional)")
    .option("--auth-basic [user:pass]", "Basic authentication username:password (optional)")
    .option("--auth-apikey [key]", "API key authentication (optional)")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      addMcpCommand({ ...options, ...globalOpts });
    });

  command
    .command("list")
    .description("list all MCP servers (requires valid token)")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      listMcpCommand({ ...options, ...globalOpts });
    });

  command
    .command("remove [namespace]")
    .description("remove an MCP server (requires valid token)")
    .option("--all", "Remove all MCPs created by you")
    .action((namespace, options, command) => {
      const globalOpts = command.parent.parent.opts();
      removeMcpCommand(namespace, { ...options, ...globalOpts });
    });

  command.addHelpText("after", HELP_FOOTER);

  return command;
}