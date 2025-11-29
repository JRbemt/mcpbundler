import { BundlerAPIClient, Mcp } from "../../utils/api-client.js";
import { UpstreamAuthConfig } from "../../../core/config/schemas.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";
import logger from "../../../utils/logger.js";
import { canFetchMcp, fetchMcpCapabilities } from "./capabilities/fetch.js";

interface AddManualOptions {
  url: string;
  namespace: string;
  stateless: boolean;
  author: string;
  mcpVersion: string;
  description: string;
  authType?: "MASTER" | "TOKEN_SPECIFIC" | "NONE";
  authBearer?: string;
  authBasic?: string;
  authApikey?: string;
  host: string;
  token: string;
}

/**
 * Add an MCP manually via URL and metadata
 */
export async function addMcpCommand(options: AddManualOptions): Promise<void> {
  try {
    // Parse auth configuration
    let authConfig: UpstreamAuthConfig | undefined;
    const authOptionsCount = [
      options.authBearer,
      options.authBasic,
      options.authApikey
    ].filter(Boolean).length;

    if (authOptionsCount > 1) {
      console.error("Error: Only one auth option can be specified at a time");
      process.exit(1);
    }

    if (options.authBearer) {
      authConfig = {
        method: "bearer",
        token: options.authBearer,
      };
    } else if (options.authBasic) {
      const [username, password] = options.authBasic.split(":");
      if (!username || !password) {
        console.error("Error: --auth-basic must be in format \"username:password\"");
        process.exit(1);
      }
      authConfig = {
        method: "basic",
        username,
        password,
      };
    } else if (options.authApikey) {
      authConfig = {
        method: "api_key",
        key: options.authApikey,
        header: "X-API-Key",
      };
    }
    const namespace = options.namespace;

    // Determine auth strategy
    let authStrategy: "MASTER" | "TOKEN_SPECIFIC" | "NONE" = "NONE";
    if (options.authType) {
      authStrategy = options.authType;
    } else if (authConfig) {
      authStrategy = "MASTER";
    }

    if (authStrategy === "MASTER" && !(options.authBasic || options.authApikey || options.authBearer)) {
      console.error("--auth-strategy set to MASTER, but no auth credentials were given");
      throw new Error("--auth-strategy set to MASTER, but no auth credentials were given");
    }

    // Build upstream config
    const upstreamConfig: any = {
      namespace,
      url: options.url,
      author: options.author,
      description: options.description,
      version: options.mcpVersion,
      stateless: options.stateless ?? false,
      authStrategy,
      masterAuthConfig: authConfig ? JSON.stringify(authConfig) : undefined,
    };

    const client = new BundlerAPIClient(options.host, options.token);
    const mcp = await client.createMcp(upstreamConfig);

    banner(" MCP Server Added ", { bg: BG_COLORS.GREEN });
    console.group()
    const tableData = [{
      Namespace: mcp.namespace,
      URL: mcp.url,
      Author: mcp.author,
      Version: mcp.version,
      Stateless: mcp.stateless ? "Yes" : "No",
      "Auth Strategy": mcp.auth_strategy || "NONE",
      "Master Auth": authConfig ? authConfig.method : "None",
    }];

    console.table(tableData);

    console.log(`\nDescription: ${mcp.description}`);
    console.groupEnd()
    console.log()

    const can_fetch_capbailities = canFetchMcp(mcp)

    // Display overview
    if (can_fetch_capbailities.canQuery) {
      const capabilities = await fetchMcpCapabilities(mcp);


      if (capabilities) {
        banner(" MCP Capabilities ", { bg: BG_COLORS.GREEN });
        // Display tools table
        if (capabilities.tools.length > 0) {
          console.log(`   Tools (${capabilities.tools.length}):`);
          const toolsToShow = capabilities.tools.slice(0, 10);

          // Helper function to wrap text at specified width
          const wrapText = (text: string, width: number): string[] => {
            if (!text) return ["-"];
            const words = text.split(" ");
            const lines: string[] = [];
            let currentLine = "";

            for (const word of words) {
              const testLine = currentLine ? currentLine + " " + word : word;
              if (testLine.length <= width) {
                currentLine = testLine;
              } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
              }
            }
            if (currentLine) lines.push(currentLine);

            return lines;
          };

          // Custom table formatter for multi-line content
          const nameColWidth = 30;
          const descColWidth = 80;

          // ANSI color codes
          const green = "\x1b[32m";
          const reset = "\x1b[0m";

          console.group();
          console.log(`   ┌─${"─".repeat(nameColWidth)}─┬─${"─".repeat(descColWidth)}─┐`);
          console.log(`   │ ${green}${"Name".padEnd(nameColWidth)}${reset} │ ${green}${"Description".padEnd(descColWidth)}${reset} │`);
          console.log(`   ├─${"─".repeat(nameColWidth)}─┼─${"─".repeat(descColWidth)}─┤`);

          toolsToShow.forEach((tool, index) => {
            const nameLines = wrapText(tool.name, nameColWidth);
            const descLines = wrapText(tool.description || "-", descColWidth);
            const maxLines = Math.max(nameLines.length, descLines.length);

            for (let i = 0; i < maxLines; i++) {
              const namePart = nameLines[i] || "";
              const descPart = descLines[i] || "";
              console.log(`   │ ${green}${namePart.padEnd(nameColWidth)}${reset} │ ${green}${descPart.padEnd(descColWidth)}${reset} │`);
            }

            // Add separator between tools (but not after the last one)
            if (index < toolsToShow.length - 1) {
              console.log(`   ├─${"─".repeat(nameColWidth)}─┼─${"─".repeat(descColWidth)}─┤`);
            }
          });

          // Add "more" row if there are additional tools
          if (capabilities.tools.length > 10) {
            console.log(`   ├─${"─".repeat(nameColWidth)}─┼─${"─".repeat(descColWidth)}─┤`);
            const moreText = `... ${capabilities.tools.length - 10} more tool(s) not shown ...`;
            console.log(`   │ ${green}${"...".padEnd(nameColWidth)}${reset} │ ${green}${moreText.padEnd(descColWidth)}${reset} │`);
          }

          console.log(`   └─${"─".repeat(nameColWidth)}─┴─${"─".repeat(descColWidth)}─┘`);
          console.groupEnd();
        } else {
          console.log("   Tools: 0");
        }

        // Display resource and prompt counts only
        console.log(`   Resources: ${capabilities.resources.length}`);
        console.log(`   Prompts: ${capabilities.prompts.length}`);
      } else {
        banner(" Failed to fetch capabilities", { bg: BG_COLORS.YELLOW });
        console.log("   " + can_fetch_capbailities.reason);
      }
    } else {
      banner(" Fetching MCP capabilities not possible ", { bg: BG_COLORS.YELLOW });
      console.log("   " + can_fetch_capbailities.reason);
    }
    console.log();
  } catch (error: any) {
    console.error(`Failed to add MCP: ${error.response?.data?.error || error.message}`);

    if (error.response?.data?.details) {
      logger.error("\nValidation errors:");
      if (Array.isArray(error.response.data.details)) {
        error.response.data.details.forEach((detail: any) => {
          const field = detail.path?.join(".") || "unknown";
          console.error(`  - ${field}: ${detail.message}`);
        });
      } else {
        console.error(`  ${JSON.stringify(error.response.data.details, null, 2)}`);
      }
    }

    process.exit(1);
  }
}
