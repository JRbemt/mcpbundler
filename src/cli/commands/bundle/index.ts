import { Command } from "commander";
import { listBundlesCommand } from "./list.js";
import { createBundleCommand } from "./create.js";
import { removeBundleCommand } from "./remove.js";
import { showBundleCommand } from "./show.js";
import { HELP_FOOTER } from "../../utils/print-utils.js";
import { createTokenCommand } from "./token/index.js";
import { createBundleMcpCommand } from "./mcp/index.js";


export function createBundlesCommand(): Command {
  const command = new Command("bundle")
    .description("manage bundles")
    .showHelpAfterError()
    .showSuggestionAfterError();

  command.addCommand(createBundleMcpCommand());
  command.addCommand(createTokenCommand());

  command
    .command("list")
    .description("list bundles (requires valid token)")
    .option("--me", "list only bundles created by you")
    .action((options, cmd) => {
      listBundlesCommand(cmd.optsWithGlobals());
    });

  command
    .command("create <name> <description>")
    .description("create a new bundle (requires valid token)")
    .action((name, description, options, cmd) => {
      createBundleCommand(name, description, cmd.optsWithGlobals());
    });

  command
    .command("remove <bundle-id>")
    .description("remove a bundle by name (requires valid token)")
    .action((id, options, cmd) => {
      removeBundleCommand(id, cmd.optsWithGlobals());
    });

  command
    .command("show <bundle-id>")
    .description("show details of a bundle and its MCPs (requires valid token)")
    .action((id, options, cmd) => {
      showBundleCommand(id, cmd.optsWithGlobals());
    });

  command.addHelpText("after", HELP_FOOTER);
  return command;
}
