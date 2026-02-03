import { MCPAuthConfig } from "../../../shared/domain/entities.js";
import { BundlerAPIClient, Mcp } from "../../utils/api-client.js";
import { banner, BG_COLORS, printTable } from "../../utils/print-utils.js";
import { canFetchMcp, fetchMcpCapabilities } from "./capabilities/fetch.js";

interface AddManualOptions {
  stateless: boolean;
  mcpVersion: string;
  description: string;
  authStrategy?: "MASTER" | "USER_SET" | "NONE";
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
      const parts = options.authApikey.split(":");
      const key = parts[0].trim();
      const header = parts.length > 1 ? parts.slice(1).join(":").trim() : "X-API-Key";
      authConfig = {
        method: "api_key",
        key,
        header,
      };
    }

    // Determine auth strategy
    let authStrategy: "MASTER" | "USER_SET" | "NONE" = "NONE";
    if (options.authStrategy) {
      authStrategy = options.authStrategy;
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
          const toolsData = capabilities.tools.map((tool: { name: string; description?: string }) => ({
            name: tool.name,
            description: tool.description || "-",
          }));
          printTable(toolsData, {
            columns: [
              { header: "Name", width: 30, key: "name" },
              { header: "Description", width: 80, key: "description" },
            ],
            maxRows: 5,
          });
        } else {
          console.log("Tools: 0");
        }

        // Display resource and prompt counts only
        console.log(`Resources: ${capabilities.resources.length}`);
        console.log(`Prompts: ${capabilities.prompts.length}`);
      } else {
        banner(" Failed to fetch capabilities ", { bg: BG_COLORS.MAGENTA });
        console.log("   Check the error above for details. Common causes: invalid URL, auth failure, or server unreachable.");
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
