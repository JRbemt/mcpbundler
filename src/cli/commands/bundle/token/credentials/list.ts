import { BundlerAPIClient } from "../../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../../utils/print-utils.js";

interface ListCredentialsOptions {
    host: string;
}

/**
 * List all credentials for a bundle token
 */
export async function listCredentialsCommand(
    bundleToken: string,
    options: ListCredentialsOptions
): Promise<void> {
    const client = new BundlerAPIClient(options.host);

    try {
        const credentials = await client.listCredentials(bundleToken);

        banner(" Credentials ", { bg: BG_COLORS.BLUE });
        console.group();

        if (credentials.length === 0) {
            console.log("(No credentials configured for this bundle token)");
            console.groupEnd();
            return;
        }

        const tableData = credentials.map(cred => ({
            "Credential ID": cred.credentialId,
            "MCP Namespace": cred.mcpNamespace,
            "MCP URL": cred.mcpUrl,
            "Created": new Date(cred.createdAt).toLocaleString(),
            "Updated": new Date(cred.updatedAt).toLocaleString(),
        }));

        console.table(tableData);
        console.groupEnd();
        console.log();

    } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.message;
        console.error(`Failed to list credentials: ${errorMessage}`);
        process.exit(1);
    }
}
