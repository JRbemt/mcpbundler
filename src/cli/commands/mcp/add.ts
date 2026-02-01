import { MCPAuthConfig } from "../../../shared/domain/entities.js";
import { BundlerAPIClient, Mcp } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";
import { canFetchMcp, fetchMcpCapabilities } from "./capabilities/fetch.js";

interface AddManualOptions {
  stateless: boolean;
  mcpVersion: string;
  description: string;
  authType?: "MASTER" | "USER_SET" | "NONE";
  authBearer?: string;
  authBasic?: string;
  authApikey?: string;
  host: string;
  token: string;
}

/**
 * Add an MCP manually via URL and metadata
 */
export async function addMcpCommand(namespace: string, url: string, options: AddManualOptions): Promise<void> {
  try {
    // Parse auth configuration
    let authConfig: MCPAuthConfig | undefined;
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

    // Determine auth strategy
    let authStrategy: "MASTER" | "USER_SET" | "NONE" = "NONE";
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
    const data = {
      namespace,
      url,
      authStrategy,
      description: options.description,
      version: options.mcpVersion,
      stateless: options.stateless,
      masterAuth: authConfig,
    };

    const client = new BundlerAPIClient(options.host, options.token);
    const mcp = await client.createMcp(data);

    banner(" MCP Server Added ", { bg: BG_COLORS.GREEN });
    console.group()
    const tableData = [{
      Namespace: mcp.namespace,
      URL: mcp.url,
      Creator: mcp.createdBy?.name,
      Version: mcp.version,
      Stateless: mcp.stateless ? "Yes" : "No",
      "Auth Strategy": mcp.authStrategy || "NONE",
      "Master Auth": authConfig ? authConfig.method : "None",
    }];

    console.table(tableData);

    console.log(`Description: ${mcp.description}`);
    console.groupEnd()
    console.log()

    const can_fetch_capbalities = canFetchMcp(mcp, authConfig)

    // Display overview
    if (can_fetch_capbalities.canQuery) {
      const capabilities = await fetchMcpCapabilities(mcp, authConfig);


      if (capabilities) {
        banner(" MCP Capabilities ", { bg: BG_COLORS.GREEN });
        // Display tools table
        if (capabilities.tools.length > 0) {
          console.log(`Tools (${capabilities.tools.length}):`);
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

          toolsToShow.forEach((tool: { name: string, description?: string }, index: number) => {
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
          console.log("Tools: 0");
        }

        // Display resource and prompt counts only
        console.log(`Resources: ${capabilities.resources.length}`);
        console.log(`Prompts: ${capabilities.prompts.length}`);
      } else {
        banner(" Failed to fetch capabilities ", { bg: BG_COLORS.MAGENTA });
        console.log("   " + can_fetch_capbalities.reason);
      }
    } else {
      banner(" Fetching MCP capabilities not possible ", { bg: BG_COLORS.MAGENTA });
      console.log("   " + can_fetch_capbalities.reason);
    }
    console.log();

    process.exit(0);
  } catch (error: any) {
    const errorMessage = error.response?.data?.error || error.message;
    console.error(`Failed to add MCP: ${errorMessage}`);
    process.exit(1);
  }
}
