#!/usr/bin/env node

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createServerCommand } from './commands/server/index.js';
import { createMcpsCommand } from './commands/mcp/index.js';
import { createClientCommand } from './commands/client/index.js';
import { createCollectionsCommand } from './commands/collections/index.js';

// Load package.json metadata
const __dirname = dirname(fileURLToPath(import.meta.url));
const pckg = JSON.parse(
  readFileSync(join(__dirname, '../../../package.json'), 'utf-8')
);

const program = new Command();

program
  .name('mcpbundler')
  .description(pckg.description)
  .version(pckg.version);

// Add command groups
program.addCommand(createServerCommand());
program.addCommand(createMcpsCommand());
program.addCommand(createCollectionsCommand());
program.addCommand(createClientCommand());

program.parse();
