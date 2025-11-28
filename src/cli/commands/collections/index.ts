/**
 * MCPs and Collections Command Groups
 *
 * HTTP API client commands for managing collections and MCP servers
 */

import { Command } from "commander";
import { listCollectionsCommand } from "./list.js";
import { createCollectionCommand } from "./create.js";
import { removeCollectionCommand } from "./remove.js";
import { getTokenCommand as getAccessTokenCommand } from "./get-token.js";
import { HELP_FOOTER } from "../../utils/print-utils.js";


export function createCollectionsCommand(): Command {
  const command = new Command("collections")
    .description("manage collections")
    .showHelpAfterError()
    .showSuggestionAfterError();

  command
    .command("access <collection-name>")
    .description("generate access token for a collection (requires valid token)")
    .action((collectionName, options, command) => {
      const globalOpts = command.parent.parent.opts();
      getAccessTokenCommand(collectionName, { ...options, ...globalOpts });
    });

  command
    .command("create <name>")
    .description("create a new collection (requires valid token)")
    .action((name, options, command) => {
      const globalOpts = command.parent.parent.opts();
      createCollectionCommand(name, { ...options, ...globalOpts });
    });

  command
    .command("list")
    .description("list all collections (requires valid token)")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      listCollectionsCommand({ ...options, ...globalOpts });
    });

  command
    .command("remove <name>")
    .description("remove a collection by name (requires valid token to manage own collections, or an admin token for all collections)")
    .action((name, options, command) => {
      const globalOpts = command.parent.parent.opts();
      removeCollectionCommand(name, { ...options, ...globalOpts });
    });

  command.addHelpText("after", HELP_FOOTER);
  return command;
}
