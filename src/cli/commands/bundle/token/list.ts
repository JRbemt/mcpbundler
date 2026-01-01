import { BundlerAPIClient } from "../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../utils/print-utils.js";

interface TokenOptions {
    host: string;
    token?: string;
}

/**
 * List all tokens for a bundle
 */
export async function listBundleTokensCommand(id: string, options: TokenOptions): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        const tokens = await client.listBundleTokens(id);
        banner(` Tokens for Bundle: ${id} `, { bg: BG_COLORS.MAGENTA });
        console.group();

        if (tokens.length === 0) {
            console.log("(No tokens found for this bundle)");
            console.groupEnd();
            return;
        }

        const tableData = tokens.map(token => ({
            "Token ID": token.id,
            Name: token.name,
            Description: token.description || "-",
            Revoked: token.revoked ? "YES" : "NO",
            "Expires At": token.expiresAt ? new Date(token.expiresAt).toLocaleString() : "Never",
            "Created At": new Date(token.createdAt).toLocaleString(),
        }));

        console.table(tableData);
        console.groupEnd();
        console.log();

    } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.message;
        console.error(`Failed to list tokens: ${errorMessage}`);
        process.exit(1);
    }
}
