import { BundlerAPIClient, Mcp } from "../../utils/api-client.js";
import { UpstreamAuthConfig } from "../../../core/config/schemas.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { buildAuthOptions } from "../../../utils/upstream-auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import logger from "../../../utils/logger.js";

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
    if (!namespace) {
      logger.error("Error: --namespace is required when adding an MCP");
      process.exit(1);
    }

    // Determine auth strategy
    let authStrategy: "MASTER" | "TOKEN_SPECIFIC" | "NONE" = "NONE";
    if (options.authType) {
      authStrategy = options.authType;
    } else if (authConfig) {
      authStrategy = "MASTER";
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

    // Display overview

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
