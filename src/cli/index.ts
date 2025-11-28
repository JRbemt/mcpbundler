#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createDaemonCommand as createDaemonCommand } from "./commands/daemon/index.js";
import { createMcpsCommand } from "./commands/mcp/index.js";
import { createClientCommand } from "./commands/client/index.js";
import { createCollectionsCommand } from "./commands/collections/index.js";
import { createUserCommand } from "./commands/user/index.js";
import { HELP_FOOTER } from "./utils/print-utils.js";

// Load package.json metadata
const __dirname = dirname(fileURLToPath(import.meta.url));
const pckg = JSON.parse(
  readFileSync(join(__dirname, "../../../package.json"), "utf-8")
);

export const program = new Command();

export function getParent() {

}

program
  .name("mcpbundler")
  .description(pckg.description)
  .version(pckg.version)
  .option("-h, --host [host]", "server adress of the API", "http://0.0.0.0:3000")
  .option("-t, --token [token]", "user token for API authentication (mcpb_*)")
  .showHelpAfterError()
  .showSuggestionAfterError();

// Add command groups

program.addCommand(createDaemonCommand());
program.addCommand(createMcpsCommand());
program.addCommand(createCollectionsCommand());
program.addCommand(createClientCommand());
program.addCommand(createUserCommand())

program.addHelpText("after", HELP_FOOTER)

program.parse();
