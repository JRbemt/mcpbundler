import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface ShowBundleOptions {
    host: string;
    token?: string;
}

function formatPermissions(permissions: string[]): string {
    if (permissions.includes("*")) return "ALL";
    if (permissions.length === 0) return "NONE";
    return permissions.join(", ");
}

/**
 * Show detailed information about a bundle and its MCPs
 */
export async function showBundleCommand(id: string, options: ShowBundleOptions): Promise<void> {
    const client = new BundlerAPIClient(options.host, options.token);

    try {
        const bundle = await client.getBundle(id);
        banner(` Bundle: ${bundle.name} `, { bg: BG_COLORS.GREEN });
        console.group();

        console.log(`ID: ${bundle.id}`);
        console.log(`Created: ${new Date(bundle.createdAt).toLocaleString()}`);
        console.log(`MCPs: ${bundle.mcps?.length}`);

        if (!bundle.mcps || bundle.mcps.length === 0) {
            console.log("(No MCPs in this bundle)");
            console.groupEnd();
            return;
        }
        console.log();
        const tableData = bundle.mcps.map((mcp) => ({
            Namespace: mcp.namespace,
            URL: mcp.url.length > 40 ? mcp.url.substring(0, 37) + "..." : mcp.url,
            Author: mcp.createdBy?.name || "Unknown",
            Version: mcp.version || "-",
            Stateless: mcp.stateless ? "Yes" : "No",
            Auth: mcp.authStrategy || "NONE",
            Tools: formatPermissions(mcp.permissions?.allowedTools || ["*"]),
            Resources: formatPermissions(mcp.permissions?.allowedResources || ["*"]),
            Prompts: formatPermissions(mcp.permissions?.allowedPrompts || ["*"]),
        }));

        console.table(tableData);
        console.groupEnd();
        console.log();

    } catch (error: any) {
        const errorMessage = error.response?.data?.error || error.message;
        console.error(`Failed to show bundle: ${errorMessage}`);
        process.exit(1);
    }
}
