#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createMcpsCommand } from "./commands/mcp/index.js";
import { createBundlesCommand } from "./commands/bundle/index.js";
import { HELP_FOOTER } from "./utils/print-utils.js";
import { toStdioCommand } from "./commands/client/stdio.js";
import { createUserCommand } from "./commands/user/index.js";
import { syncCommand } from "./commands/sync.js";
import { yamlTokenCommand } from "./commands/yaml-token.js";

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
  .option("-h, --host [host]", "server adress of the mcpbundler API", "http://0.0.0.0:3997")
  .option("-t, --token [token]", "user token for API authentication (mcpb_*)")
  .showHelpAfterError()
  .showSuggestionAfterError();

// Add command groups
program.addCommand(createMcpsCommand());
program.addCommand(createBundlesCommand());
program.addCommand(createUserCommand());
program.command("stdio")
  .description("connect to bundler and expose as an STDIO Server for local integrations")
  .option("-b, --bundle <token>", "Bundle-token", "")
  .option("--name <name>", "Server name", "mcpbundler-client")

  .action((options, cmd) => {
    toStdioCommand(cmd.optsWithGlobals());
  });

program
  .command("sync")
  .description("create or update bundle definitions on registries (existing subscriptions and tokens are preserved)")
  .option("-c, --config <path>", "path to YAML config file", "mcpbundler.yaml")
  .action((options) => {
    syncCommand(options);
  });

program
  .command("token <subscription-name>")
  .description("generate an access token for a named subscription (YAML mode, requires --token)")
  .option("-c, --config <path>", "path to YAML config file", "mcpbundler.yaml")
  .action((subscriptionName, _options, cmd) => {
    yamlTokenCommand(subscriptionName, cmd.optsWithGlobals());
  });

program.addHelpText("after", HELP_FOOTER);

program.parse();
