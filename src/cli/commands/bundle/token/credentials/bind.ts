import { MCPAuthConfig } from "../../../../../shared/domain/entities.js";
import { BundlerAPIClient } from "../../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../../utils/print-utils.js";

interface BindCredentialOptions {
    authBearer?: string;
    authBasic?: string;
    authApikey?: string;
    host: string;
    token: string;
}

/**
 * Bind credentials to a bundle token + MCP namespace
 */
export async function bindCredentialCommand(
    bundleToken: string,
    namespace: string,
    options: BindCredentialOptions
): Promise<void> {
    try {
        // Parse auth configuration
        let authConfig: MCPAuthConfig | undefined;
        const authOptionsCount = [
            options.authBearer,
            options.authBasic,
            options.authApikey
        ].filter(Boolean).length;

        if (authOptionsCount === 0) {
            console.error("Error: At least one auth option must be specified (--auth-bearer, --auth-basic, or --auth-apikey)");
            process.exit(1);
        }

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

        const client = new BundlerAPIClient(options.host, options.token);
        const result = await client.bindCredential(bundleToken, namespace, authConfig!);

        banner(" Credentials Bound ", { bg: BG_COLORS.GREEN });
        console.group();

        const tableData = [{
            "Credential ID": result.credentialId,
            "MCP Namespace": result.mcpNamespace,
            "Auth Method": authConfig!.method,
            "Created": result.createdAt,
        }];

        console.table(tableData);
        console.groupEnd();
        console.log();
    } catch (error: any) {
        console.error(`Failed to bind credentials: ${error.response?.data?.error || error.message}`);

        const details = error.response?.data?.details;
        if (details) {
            // Handle structured error details (e.g., from "MCP in bundle not found")
            if (details.message) {
                console.error(`\n${details.message}`);
            }
            if (details.bundleId) {
                console.error(`  Bundle ID: ${details.bundleId}`);
            }
            if (details.availableMcps && Array.isArray(details.availableMcps)) {
                if (details.availableMcps.length > 0) {
                    console.error(`  Available MCPs: ${details.availableMcps.join(", ")}`);
                } else {
                    console.error("  Available MCPs: (none)");
                }
            }
            if (details.hint) {
                console.error(`\nHint: ${details.hint}`);
            }
            // Handle validation errors (array format)
            if (Array.isArray(details)) {
                console.error("\nValidation errors:");
                details.forEach((detail: any) => {
                    const field = detail.path?.join(".") || "unknown";
                    console.error(`  - ${field}: ${detail.message}`);
                });
            }
        }

        process.exit(1);
    }
}
