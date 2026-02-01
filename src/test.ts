import { canFetchMcp, fetchMcpCapabilities } from "./cli/commands/mcp/capabilities/fetch.js";
import { BundlerAPIClient } from "./cli/utils/api-client.js";
import { banner, BG_COLORS } from "./cli/utils/print-utils.js";

const data = {
    namespace: "files",
    url: "http://localhost:3997/mcp",
    authStrategy: "NONE" as const,
    description: "NONE",
    version: "1.0.0",
    stateless: true,
    id: "test-id",
    createdAt: new Date(),
    updatedAt: new Date(),
};
const authConfig = {
    "method": "none"
}
banner(" MCP Server Added ", { bg: BG_COLORS.GREEN });
console.group()
const tableData = [{
    Namespace: data.namespace,
    URL: data.url,
    "Auth Strategy": data.authStrategy || "NONE",
    "Master Auth": authConfig ? authConfig.method : "None",
}];

console.table(tableData);

console.log(`Description: ${data.description}`);
console.groupEnd()
console.log()

const can_fetch_capbailities = canFetchMcp(data, authConfig as any)

// Display overview
if (can_fetch_capbailities.canQuery) {
    const capabilities = await fetchMcpCapabilities(data, authConfig as any);


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

            toolsToShow.forEach((tool, index) => {
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
    }
}