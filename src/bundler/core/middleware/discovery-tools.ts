import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { BundlerSystemToolsMiddleware } from "./builtin-tools.js";
import { DiscoveryClient, PublicBundleSummary, PublicBundleDetail } from "../discovery/discovery-client.js";
import { RateLimitRule } from "./anonymous-rate-limit.js";

// Both discovery tools draw on the same shared anonymous service token
// (service-token.ts) - one abusive session's calls degrade that shared
// budget for every other anonymous agent, not just itself - so they share
// one limit rather than each getting its own.
export const DISCOVERY_RATE_LIMIT_RULES: RateLimitRule[] = [
  {
    id: "discovery",
    toolNames: ["bundler__search_bundles", "bundler__get_bundle"],
    maxCalls: 20,
    windowMs: 5 * 60 * 1000,
  },
];

function formatSummaries(bundles: PublicBundleSummary[]): string {
  if (bundles.length === 0) {
    return "No public bundles are available right now.";
  }
  return bundles
    .map((b) => {
      const tools = b.entryPreviews.map((e) => e.title).join(", ") || "no tools listed";
      const tags = b.tags.length > 0 ? b.tags.join(", ") : "none";
      return `- ${b.name} (id: ${b.id}, by ${b.ownerName}): ${b.description ?? "no description"}. ` +
        `${b.mcpCount} MCP${b.mcpCount === 1 ? "" : "s"}, tags: ${tags}. Includes: ${tools}`;
    })
    .join("\n");
}

function formatDetail(bundle: PublicBundleDetail): string {
  const tools = bundle.entries.map((e) => `${e.title} (${e.authStrategy})`).join(", ") || "no tools listed";
  return `${bundle.name} (id: ${bundle.id}): ${bundle.description ?? "no description"}\nTools: ${tools}`;
}

/**
 * Registers the two anonymous discovery tools onto the given middleware
 * instance. Kept as a plain function rather than a middleware subclass so
 * it composes with BundlerSystemToolsMiddleware's existing registry
 * instead of introducing a second tool-registration mechanism.
 */
export function registerDiscoveryTools(middleware: BundlerSystemToolsMiddleware, client: DiscoveryClient): void {
  middleware.registerTool({
    tool: {
      name: "bundler__search_bundles",
      description:
        "List recent public MCP bundles, each with its name, purpose, and the tools it includes. NOTE: results " +
        "are not yet filtered by the query text - the backend's underlying endpoint has no keyword-search " +
        "capability yet, so this returns the most recent public bundles regardless of what's asked for. The " +
        "parameter is accepted now for forward compatibility with a future filtered version.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: { type: "string", description: "Keywords describing the capability you need (not yet used to filter results - see the tool description)." },
        },
        required: ["query"],
      },
    },
    handler: async (params): Promise<CallToolResult> => {
      const query = String((params.arguments as Record<string, unknown>)?.query ?? "");
      // Pass the page size explicitly rather than relying on searchBundles's
      // default parameter - keeps it visible at the call site and makes the
      // exact arguments a test asserts on match what's actually sent.
      const results = await client.searchBundles(query, 20);
      return { content: [{ type: "text", text: formatSummaries(results) }] };
    },
  });

  middleware.registerTool({
    tool: {
      name: "bundler__get_bundle",
      description: "Get full detail for one public bundle by ID, including every tool it includes.",
      inputSchema: {
        type: "object" as const,
        properties: {
          bundle_id: { type: "string", description: "The bundle ID from a previous search result." },
        },
        required: ["bundle_id"],
      },
    },
    handler: async (params): Promise<CallToolResult> => {
      const bundleId = String((params.arguments as Record<string, unknown>)?.bundle_id ?? "");
      const bundle = await client.getBundle(bundleId);
      if (!bundle) {
        return { content: [{ type: "text", text: `No public bundle found with id "${bundleId}".` }], isError: true };
      }
      return { content: [{ type: "text", text: formatDetail(bundle) }] };
    },
  });
}
