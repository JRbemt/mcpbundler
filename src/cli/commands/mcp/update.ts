import { MCPAuthConfig } from "../../../shared/domain/entities.js";
import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface UpdateOptions {
  url?: string;
  description?: string;
  mcpVersion?: string;
  stateless?: boolean;
  authType?: "MASTER" | "USER_SET" | "NONE";
  authBearer?: string;
  authBasic?: string;
  authApikey?: string;
  clearAuth?: boolean;
  host: string;
  token: string;
}

/**
 * Update an existing MCP by namespace
 */
export async function updateMcpCommand(namespace: string, options: UpdateOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);

    // Fetch existing MCP by namespace to show before/after
    const existing = await client.getMcpByNamespace(namespace);

    // Parse auth configuration if provided
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

    // Build update payload with only provided fields
    const updateData: any = {};

    if (options.url !== undefined) {
      updateData.url = options.url;
    }

    if (options.description !== undefined) {
      updateData.description = options.description;
    }

    if (options.mcpVersion !== undefined) {
      updateData.version = options.mcpVersion;
    }

    if (options.stateless !== undefined) {
      updateData.stateless = options.stateless;
    }

    if (options.authType !== undefined) {
      updateData.authStrategy = options.authType;
    }

    // Handle auth config updates
    if (options.clearAuth) {
      updateData.masterAuth = null;
      if (!updateData.authStrategy) {
        updateData.authStrategy = "NONE";
      }
    } else if (authConfig) {
      updateData.masterAuth = authConfig;
      if (!updateData.authStrategy) {
        updateData.authStrategy = "MASTER";
      }
    }

    // Validate auth strategy consistency
    if (updateData.authStrategy === "MASTER" && !authConfig && !existing.authStrategy) {
      console.error("Error: Cannot set authStrategy to MASTER without providing auth credentials");
      process.exit(1);
    }

    // Check if any updates were provided
    if (Object.keys(updateData).length === 0) {
      console.error("Error: No updates specified. Use --help to see available options.");
      process.exit(1);
    }

    // Perform update using namespace
    const updated = await client.updateMcp(namespace, updateData);

    banner(" MCP Server Updated ", { bg: BG_COLORS.GREEN });
    console.group();

    // Show what changed
    const changes: string[] = [];
    if (options.url) changes.push(`URL: ${existing.url} → ${updated.url}`);
    if (options.description) changes.push(`Description updated`);
    if (options.mcpVersion) changes.push(`Version: ${existing.version} → ${updated.version}`);
    if (options.stateless !== undefined) changes.push(`Stateless: ${existing.stateless} → ${updated.stateless}`);
    if (options.authType) changes.push(`Auth Strategy: ${existing.authStrategy} → ${updated.authStrategy}`);
    if (authConfig) changes.push(`Master Auth: ${authConfig.method}`);
    if (options.clearAuth) changes.push(`Master Auth: cleared`);

    if (changes.length > 0) {
      console.log("Changes:");
      changes.forEach(change => console.log(`  - ${change}`));
      console.log();
    }

    // Show final state
    const tableData = [{
      Namespace: updated.namespace,
      URL: updated.url,
      Creator: updated.createdBy?.name,
      Version: updated.version,
      Stateless: updated.stateless ? "Yes" : "No",
      "Auth Strategy": updated.authStrategy || "NONE",
    }];

    console.table(tableData);
    console.log(`Description: ${updated.description}`);
    console.groupEnd();
    console.log();

    process.exit(0);
  } catch (error: any) {
    const errorMessage = error.response?.data?.error || error.message;
    console.error(`Failed to update MCP: ${errorMessage}`);
    process.exit(1);
  }
}
