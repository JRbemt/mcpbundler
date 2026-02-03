import { Command } from "commander";
import { bindCredentialCommand } from "./bind.js";
import { updateCredentialCommand } from "./update.js";
import { removeCredentialCommand } from "./remove.js";
import { listCredentialsCommand } from "./list.js";
import { HELP_FOOTER } from "../../../../utils/print-utils.js";

export function createCredentialsCommand(): Command {
    const command = new Command("credential")
        .alias("cred")
        .description("manage MCP credentials bound to a bundle token (no --token required)")
        .showHelpAfterError()
        .showSuggestionAfterError();

    command
        .command("bind <bundle-token> <mcp-namespace>")
        .description("bind MCP credentials to your token")
        .option("--auth-bearer <token>", "bearer token authentication")
        .option("--auth-basic <username:password>", "basic authentication (format: username:password)")
        .option("--auth-apikey <key[:header]>", "API key authentication (format: key or key:HeaderName, default header: X-API-Key)")
        .action((bundleToken, namespace, options, cmd) => {
            bindCredentialCommand(bundleToken, namespace, cmd.optsWithGlobals());
        });

    command
        .command("update <bundle-token> <<mcp-namespace>")
        .description("update MCP credentials for your token")
        .option("--auth-bearer <token>", "bearer token authentication")
        .option("--auth-basic <username:password>", "basic authentication (format: username:password)")
        .option("--auth-apikey <key[:header]>", "API key authentication (format: key or key:HeaderName, default header: X-API-Key)")
        .action((bundleToken, namespace, options, cmd) => {
            updateCredentialCommand(bundleToken, namespace, cmd.optsWithGlobals());
        });

    command
        .command("remove <bundle-token> <mcp-namespace>")
        .description("remove MCP credentials for you token")
        .action((bundleToken, namespace, options, cmd) => {
            removeCredentialCommand(bundleToken, namespace, cmd.optsWithGlobals());
        });

    command
        .command("list <bundle-token>")
        .description("list all MCP's with credentials in your bundle token")
        .action((bundleToken, options, cmd) => {
            listCredentialsCommand(bundleToken, cmd.optsWithGlobals());
        });

    command.addHelpText("after", HELP_FOOTER);
    return command;
}
