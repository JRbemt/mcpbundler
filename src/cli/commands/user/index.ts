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
    .description("create a new API user (requires valid token/ CREATE_USER permission or self-service enabled)")
    .requiredOption("-n, --name <name>", "username")
    .requiredOption("-c, --contact <email>", "contact email")
    .option("-d, --department <department>", "department")
    .option("-p, --permissions <perms...>", "permissions to grant (when using token)")
    .option("--admin", "Create as admin user (requires admin token)")
    .action((options, cmd) => {
      createCommand(cmd.optsWithGlobals());
    });

  user
    .command("list")
    .description("list all API users (requires valid token/ LIST_USERS permission)")
    .option("--include-revoked", "include revoked users")
    .action((options, cmd) => {
      listCommand(cmd.optsWithGlobals());
    });

  user
    .command("me")
    .description("view your own user profile (requires valid token)")
    .action((options, cmd) => {
      meCommand(cmd.optsWithGlobals());
    });

  user
    .command("revoke-created")
    .description("revoke user(s) you created (requires valid token)")
    .option("-u, --user-id <userId>", "ID of the user to revoke")
    .option("--all", "revoke ALL users you created")
    .action((options, cmd) => {
      revokeCreatedCommand(cmd.optsWithGlobals());
    });

  user
    .command("revoke-self")
    .description("revoke your own API key (requires valid token)")
    .action((options, cmd) => {
      revokeSelfCommand(cmd.optsWithGlobals());
    });

  user
    .command("update")
    .description("update your own profile (requires valid token)")
    .option("-n, --name <name>", "new name")
    .option("-c, --contact <email>", "new contact email")
    .option("-d, --department <department>", "new department")
    .action((options, cmd) => {
      updateCommand(cmd.optsWithGlobals());
    });

  user.addHelpText("after", HELP_FOOTER);

  return user;
}
