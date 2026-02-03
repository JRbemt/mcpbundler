import { Command } from "commander";
import { generateToken } from "./generate.js";
import { listBundleTokensCommand } from "./list.js";
import { revokeBundleTokenCommand } from "./revoke.js";
import { HELP_FOOTER } from "../../../utils/print-utils.js";
import { createCredentialsCommand } from "./credentials/index.js";


export function createTokenCommand(): Command {
    const command = new Command("token")
        .description("manage tokens for a bundle (requires --token)")
        .showHelpAfterError()
        .showSuggestionAfterError();

    command.addCommand(createCredentialsCommand())

    command
        .command("generate <bundle-id>")
        .description("generate a bundle-token")
        .requiredOption("--name <name>", "token name (required)", "default")
        .option("--description <desc>", "token description")
        .option("--expires <datetime>", "expiration date (ISO 8601 format)")
        .action((id, options, cmd) => {
            generateToken(id, cmd.optsWithGlobals());
        });

    command
        .command("list <bundle-id>")
        .description("list all tokens for a bundle")
        .action((id, options, cmd) => {
            listBundleTokensCommand(id, cmd.optsWithGlobals());
        });

    command
        .command("revoke <bundle-id> <token-id>")
        .description("revoke/delete a bundle token")
        .action((id, token_id, options, cmd) => {
            revokeBundleTokenCommand(id, token_id, cmd.optsWithGlobals());
        });


    command.addHelpText("after", HELP_FOOTER);
    return command;
}
