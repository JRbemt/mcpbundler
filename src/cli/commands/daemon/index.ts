/**
 * Manages the Maangemetnt API daemon lifecycle (start, stop, status)
 */

import { Command } from "commander";
import { startCommand } from "./start.js";
import { stopCommand } from "./stop.js";
import { statusCommand } from "./status.js";
import { HELP_FOOTER } from "../../utils/print-utils.js";

export function createDaemonCommand(): Command {
  const command = new Command("daemon")
    .description("run management API as background daemon")
    .showHelpAfterError()
    .showSuggestionAfterError();

  command
    .command("start")
    .description("start the daemon")
    .option("-p, --port <port>", "Port to run on", "3000")
    .option("-d, --database <url>", "Database connection URL")
    .option("--no-daemon", "Run in foreground instead of as daemon")
    .action(startCommand);

  command
    .command("stop")
    .description("stop the daemon")
    .action(stopCommand);

  command
    .command("status")
    .description("check daemon status")
    .action(statusCommand);

  command.addHelpText("after", HELP_FOOTER)

  return command;
}
