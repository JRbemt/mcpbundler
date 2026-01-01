import { BundlerAPIClient } from "../../../utils/api-client.js";
import { banner, BG_COLORS } from "../../../utils/print-utils.js";

interface GenerateTokenOptions {
    name?: string;
    description?: string;
    expires?: string;
    host: string;
    token?: string;
}

/**
 * Generate access token for a bundle
 */
export async function generateToken(id: string, options: GenerateTokenOptions): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        const tokenName = options.name || "default";

        console.log(`Generating access token for bundle: ${id}`);
        console.log(`Token name: ${tokenName}`);

        const result = await client.generateToken(
            id,
            tokenName,
            options.description,
            options.expires
        );
        banner(" Token generated ")

        console.group();
        console.log(`Bundle Token (${result.name}):`);
        console.log(`\t"${result.token}"`)

        if (result.expiresAt) {
            console.log(`Expires: ${new Date(result.expiresAt).toLocaleString()}`);
        } else {
            console.log(`Expires: Never`);
        }
        console.log();
        console.log("Store this token securely! It will not be shown again.");
        console.log("Use this token in the auhtorization header to connect to this bundle with mcpbundler.");
        console.groupEnd();
    } catch (error: any) {
        const msg = error.response?.data?.error || error.response?.data?.message || error.message;
        banner(" Token generation failed ", { bg: BG_COLORS.RED })

        console.group();
        console.log(msg);
        console.groupEnd();
        console.log();
        process.exit(1);
    }
}
