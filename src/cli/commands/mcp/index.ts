/**
 * MCPs and Bundles Command Groups
 *
 * HTTP API client commands for managing bundles and MCP servers
 */

import { Command, Option } from "commander";
import { addMcpCommand } from "./add.js";
import { removeMcpCommand } from "./remove.js";
import { listMcpCommand } from "./list.js";
import { updateMcpCommand } from "./update.js";
import { HELP_FOOTER } from "../../utils/print-utils.js";

export function createMcpsCommand(): Command {
  const command = new Command("mcp");
  command.description("manage MCPs")
    .showHelpAfterError()
    .showSuggestionAfterError();

  command.command("add <namespace> <url>")
    .description("add an MCP server manually via URL and metadata (requires valid token/ ADD_MCP permission)")
    .requiredOption("--description <description>", "Description of the MCP server")
    .option("-v, --mcp-version [version]", "Version of the MCP server", "1.0.0")
    .option("--stateless", "mark as stateless", false)
    .addOption(new Option("--auth-type <type>", "which auth credentials are used by bundles accessing the MCP").choices(["MASTER", "NONE", "USER_SET"]).default("NONE"))
    .option("--auth-bearer <token>", "bearer token authentication (optional)")
    .option("--auth-basic <user:pass>", "basic authentication username:password (optional)")
    .option("--auth-apikey <key[:header]>", "API key authentication (format: key or key:HeaderName, default header: X-API-Key)")
    .action((namespace, url, options, cmd) => {
      addMcpCommand(namespace, url, cmd.optsWithGlobals());
    });

  command
    .command("list")
    .description("list all MCP servers (requires valid token)")
    .action((options, cmd) => {
      listMcpCommand(cmd.optsWithGlobals());
    });

  command
    .command("update <namespace>")
    .description("update an existing MCP server (requires valid token and ownership)")
    .option("--url <url>", "new URL for the MCP server")
    .option("--description <description>", "new description")
    .option("-v, --mcp-version <version>", "new version")
    .option("--stateless", "mark as stateless")
    .option("--no-stateless", "mark as stateful")
    .addOption(new Option("--auth-type <type>", "auth strategy for bundles accessing the MCP").choices(["MASTER", "NONE", "USER_SET"]))
    .option("--auth-bearer <token>", "bearer token authentication")
    .option("--auth-basic <user:pass>", "basic authentication username:password")
    .option("--auth-apikey <key[:header]>", "API key authentication (format: key or key:HeaderName, default header: X-API-Key)")
    .option("--clear-auth", "remove master auth credentials")
    .action((namespace, options, cmd) => {
      updateMcpCommand(namespace, cmd.optsWithGlobals());
    });

  command
    .command("remove <namespace>")
    .description("remove an MCP server (requires valid token)")
    .option("--all", "Remove all MCPs created by you")
    .action((namespace, options, cmd) => {
      removeMcpCommand(namespace, cmd.optsWithGlobals());
    });

  command.addHelpText("after", HELP_FOOTER);

  return command;
}