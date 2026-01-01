import { Command } from "commander";
import { listCommand } from "./list.js";
import { showCommand } from "./show.js";
import { addCommand } from "./add.js";
import { removeCommand } from "./remove.js";
import { HELP_FOOTER } from "../../../utils/print-utils.js";

export function createPermissionsCommand(): Command {
  const permissions = new Command("permissions")
    .description("Manage user permissions")
    .showHelpAfterError()
    .showSuggestionAfterError();

  permissions
    .command("add <user-id> <permissions...>")
    .description("add one of your permissions to a created user (requires valid token)")
    .option("--propagate", "cascade permission to all descendants")
    .action((userId, permission, options, command) => {
      const globalOpts = command.parent.parent.parent.opts();
      addCommand(userId, permission, { ...options, ...globalOpts });
    });

  permissions
    .command("list")
    .description("list all available permission types (no token required)")
    .action((options, command) => {
      const globalOpts = command.parent.parent.parent.opts();
      listCommand({ ...options, ...globalOpts });
    });

  permissions
    .command("remove <user-id> <permissions...>")
    .description("remove one of your permissions from a created user (cascades to descendants) (requires valid token)")
    .action((userId, permission, options, command) => {
      const globalOpts = command.parent.parent.parent.opts();
      removeCommand(userId, permission, { ...options, ...globalOpts });
    });

  permissions
    .command("show <user-id>")
    .description("show user permissions (requires valid token, VIEW_PERMISSIONS for others)")
    .action((userId, options, command) => {
      const globalOpts = command.parent.parent.parent.opts();
      showCommand(userId, { ...options, ...globalOpts });
    });


  permissions.addHelpText("after", HELP_FOOTER);

  return permissions;
}
