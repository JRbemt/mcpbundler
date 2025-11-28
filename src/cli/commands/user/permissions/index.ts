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
    .command("add <username> <permission>")
    .description("Add one of your permissions to a created user")
    .option("--propagate", "Cascade permission to all descendants")
    .action((username, permission, options, command) => {
      const globalOpts = command.parent.parent.opts();
      addCommand(username, permission, { ...options, ...globalOpts });
    });

  permissions
    .command("list")
    .description("List all available permission types (public endpoint)")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      listCommand({ ...options, ...globalOpts });
    });

  permissions
    .command("remove <username> <permission>")
    .description("Remove one of your permissions from a created user (cascades to descendants)")
    .action((username, permission, options, command) => {
      const globalOpts = command.parent.parent.opts();
      removeCommand(username, permission, { ...options, ...globalOpts });
    });

  permissions
    .command("show [username]")
    .description("Show user permissions (requires valid token, VIEW_PERMISSIONS for others)")
    .action((username, options, command) => {
      const globalOpts = command.parent.parent.opts();
      showCommand(username, { ...options, ...globalOpts });
    });

  permissions.addHelpText("after", HELP_FOOTER);

  return permissions;
}
