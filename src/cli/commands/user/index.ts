import { Command } from "commander";
import { createCommand } from "./create.js";
import { meCommand } from "./me.js";
import { updateCommand } from "./update.js";
import { revokeSelfCommand } from "./revoke-self.js";
import { revokeCreatedCommand } from "./revoke-created.js";
import { listCommand } from "./list.js";
import { createPermissionsCommand } from "./permissions/index.js";
import { HELP_FOOTER } from "../../utils/print-utils.js";

export function createUserCommand(): Command {
  const user = new Command("user")
    .description("manage API users")
    .showHelpAfterError()
    .showSuggestionAfterError();

  user.addCommand(createPermissionsCommand());

  user
    .command("create")
    .description("create a new API user (requires CREATE_USER permission or self-service enabled)")
    .requiredOption("-n, --name <name>", "User name")
    .requiredOption("-c, --contact <email>", "Contact email")
    .option("-d, --department <department>", "Department")
    .option("-p, --permissions <perms...>", "Permissions to grant (when using token)")
    .option("--admin", "Create as admin user (requires admin token)")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      createCommand({ ...options, ...globalOpts });
    });

  user
    .command("list")
    .description("list all API users (requires LIST_USERS permission or admin)")
    .option("--include-revoked", "Include revoked users")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      listCommand({ ...options, ...globalOpts });
    });

  user
    .command("me")
    .description("view your own user profile (requires valid token)")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      meCommand({ ...options, ...globalOpts });
    });

  user
    .command("revoke-created")
    .description("revoke user(s) you created (requires valid token)")
    .option("-u, --user-id <userId>", "ID of the user to revoke")
    .option("--all", "Revoke ALL users you created")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      revokeCreatedCommand({ ...options, ...globalOpts });
    });

  user
    .command("revoke-self")
    .description("revoke your own API key (requires valid token)")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      revokeSelfCommand({ ...options, ...globalOpts });
    });

  user
    .command("update")
    .description("update your own profile (requires valid token)")
    .option("-n, --name <name>", "New name")
    .option("-c, --contact <email>", "New contact email")
    .option("-d, --department <department>", "New department")
    .action((options, command) => {
      const globalOpts = command.parent.parent.opts();
      updateCommand({ ...options, ...globalOpts });
    });

  user.addHelpText("after", HELP_FOOTER);

  return user;
}
