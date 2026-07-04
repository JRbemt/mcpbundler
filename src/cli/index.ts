#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { HELP_FOOTER } from "./utils/print-utils.js";
import { toStdioCommand } from "./commands/client/stdio.js";

// Load package.json metadata
const __dirname = dirname(fileURLToPath(import.meta.url));
const pckg = JSON.parse(
  readFileSync(join(__dirname, "../../../package.json"), "utf-8")
);

export const program = new Command();

program
  .name("mcpbundler")
  .description(pckg.description)
  .version(pckg.version)
  .showHelpAfterError()
  .showSuggestionAfterError();

program.command("stdio")
  .description("connect to bundler and expose as an STDIO Server for local integrations")
  .option("-b, --bundle <token>", "Bundle-token", "")
  .option("--name <name>", "Server name", "mcpbundler-client")
  .action((options, cmd) => {
    toStdioCommand(cmd.optsWithGlobals());
  });

program.addHelpText("after", HELP_FOOTER);

program.parse();
