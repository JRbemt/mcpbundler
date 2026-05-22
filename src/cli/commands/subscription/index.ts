import { Command } from "commander";
import { listSubscriptionsCommand } from "./list.js";
import { deleteSubscriptionCommand } from "./delete.js";
import { createSubscriptionTokenCommand } from "./token/index.js";
import { HELP_FOOTER } from "../../utils/print-utils.js";

export function createSubscriptionCommand(): Command {
  const command = new Command("subscription")
    .description("manage subscriptions (named bundle links with credentials)")
    .showHelpAfterError()
    .showSuggestionAfterError();

  command
    .command("list")
    .description("list subscriptions owned by the authenticated user")
    .action((_options, cmd) => {
      listSubscriptionsCommand(cmd.optsWithGlobals());
    });

  command
    .command("delete <name>")
    .description("delete a subscription and revoke all its tokens")
    .action((name, _options, cmd) => {
      deleteSubscriptionCommand(name, cmd.optsWithGlobals());
    });

  command.addCommand(createSubscriptionTokenCommand());

  command.addHelpText("after", HELP_FOOTER);
  return command;
}
