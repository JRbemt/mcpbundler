import { Command } from "commander";
import { HELP_FOOTER } from "../../../utils/print-utils.js";
import { addMcpToBundleCommand } from "./add.js";
import { removeMcpFromBundleCommand } from "./remove.js";


export function createBundleMcpCommand(): Command {
    const command = new Command("mcp")
        .description("manage mcps in a specific bundle")
        .showHelpAfterError()
        .showSuggestionAfterError();

    command
        .command("add <id> <namespace...>")
        .description("add namespace(s) to bundle (requires valid token)")
        .option("--tools <items...>", "permitted tools, support regex (e.g. tool1 tool2 etc. [ALL=*, NONE=''])")
        .option("--resources <items...>", "permitted resources (e.g. resource1 resource2 etc. [ALL=*, NONE=''])")
        .option("--prompts <items...>", "permitted prompts (e.g. prompt1 prompt2 etc. [ALL=*, NONE=''])")
        .action((id, namespaces, options, cmd) => {
            addMcpToBundleCommand(id, namespaces, cmd.optsWithGlobals());
        });

    command
        .command("remove <id> <namespace...>")
        .description("remove namespace(s) from bundle (requires valid token)")
        .action((id, namespaces, options, cmd) => {
            removeMcpFromBundleCommand(id, namespaces, cmd.optsWithGlobals());
        });


    command.addHelpText("after", HELP_FOOTER);
    return command;
}
