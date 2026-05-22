import { Command } from "commander";
import { generateSubscriptionTokenCommand } from "./generate.js";
import { listSubscriptionTokensCommand } from "./list.js";
import { revokeSubscriptionTokenCommand } from "./revoke.js";
import { HELP_FOOTER } from "../../../utils/print-utils.js";

export function createSubscriptionTokenCommand(): Command {
  const command = new Command("token")
    .description("manage tokens for a subscription")
    .showHelpAfterError()
    .showSuggestionAfterError();

  command
    .command("generate <subscription-name>")
    .description("generate an access token for a subscription")
    .option("--name <name>", "token name (defaults to subscription name)")
    .option("--description <desc>", "token description")
    .option("--expires <datetime>", "expiration date (ISO 8601)")
    .action((name, _options, cmd) => {
      generateSubscriptionTokenCommand(name, cmd.optsWithGlobals());
    });

  command
    .command("list <subscription-name>")
    .description("list all tokens for a subscription")
    .action((name, _options, cmd) => {
      listSubscriptionTokensCommand(name, cmd.optsWithGlobals());
    });

  command
    .command("revoke <subscription-name> <token-id>")
    .description("revoke a token")
    .action((name, tokenId, _options, cmd) => {
      revokeSubscriptionTokenCommand(name, tokenId, cmd.optsWithGlobals());
    });

  command.addHelpText("after", HELP_FOOTER);
  return command;
}
