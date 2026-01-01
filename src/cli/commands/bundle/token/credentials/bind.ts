import { BundlerAPIClient } from "../../../../utils/api-client.js";
import { MCPAuthConfig } from "../../../../../core/config/schemas.js";
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
            authConfig = {
                method: "api_key",
                key: options.authApikey,
                header: "X-API-Key",
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
            "Created": new Date(result.createdAt).toLocaleString(),
        }];

        console.table(tableData);
        console.groupEnd();
        console.log();
    } catch (error: any) {
        console.error(`Failed to bind credentials: ${error.response?.data?.error || error.message}`);

        if (error.response?.data?.details) {
            console.error("\nValidation errors:");
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
