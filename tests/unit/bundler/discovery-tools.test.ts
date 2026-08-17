import { describe, it, expect, vi } from "vitest";
import { BundlerSystemToolsMiddleware } from "../../../src/bundler/core/middleware/builtin-tools.js";
import { registerDiscoveryTools, DISCOVERY_RATE_LIMIT_RULES } from "../../../src/bundler/core/middleware/discovery-tools.js";
import type { DiscoveryClient } from "../../../src/bundler/core/discovery/discovery-client.js";
import type { MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";

function makeCtx(): MiddlewareContext {
  return {
    sessionId: "s1",
    bundleId: "anonymous",
    notifyToolsChanged: vi.fn(),
    notifyResourcesChanged: vi.fn(),
    notifyPromptsChanged: vi.fn(),
    attachUpstream: vi.fn().mockResolvedValue(undefined),
    detachUpstream: vi.fn(),
    getAttachedNamespaces: vi.fn().mockReturnValue([]),
    getAvailableUpstreams: vi.fn().mockReturnValue([]),
  };
}

function makeClient(overrides: Partial<DiscoveryClient> = {}): DiscoveryClient {
  return {
    searchBundles: vi.fn().mockResolvedValue([]),
    getBundle: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as DiscoveryClient;
}

describe("registerDiscoveryTools", () => {
  it("registers both tools on the middleware", () => {
    const mw = new BundlerSystemToolsMiddleware();
    registerDiscoveryTools(mw, makeClient());
    expect(mw.getRegisteredToolNames()).toEqual(["bundler__search_bundles", "bundler__get_bundle"]);
  });

  describe("bundler__search_bundles", () => {
    it("returns bundle summaries as formatted text", async () => {
      const client = makeClient({
        searchBundles: vi.fn().mockResolvedValue([
          {
            id: "b1",
            name: "GitHub Toolkit",
            description: "Search and manage repos",
            ownerName: "acme",
            mcpCount: 2,
            tags: ["dev"],
            entryPreviews: [{ alias: "gh", title: "GitHub" }],
          },
        ]),
      });
      const mw = new BundlerSystemToolsMiddleware();
      registerDiscoveryTools(mw, client);

      const result = await mw.handleOwnToolCall(
        { name: "bundler__search_bundles", arguments: { query: "github" } },
        makeCtx()
      );

      expect(result!.isError).toBeFalsy();
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toContain("b1");
      expect(text).toContain("GitHub Toolkit");
      expect(text).toContain("GitHub");
      expect(client.searchBundles).toHaveBeenCalledWith("github", 20);
    });

    it("reports no results found rather than returning empty content", async () => {
      const mw = new BundlerSystemToolsMiddleware();
      registerDiscoveryTools(mw, makeClient());

      const result = await mw.handleOwnToolCall(
        { name: "bundler__search_bundles", arguments: { query: "nothing-matches" } },
        makeCtx()
      );

      expect((result!.content[0] as { text: string }).text.toLowerCase()).toContain("no");
    });
  });

  describe("bundler__get_bundle", () => {
    it("returns bundle detail as formatted text", async () => {
      const client = makeClient({
        getBundle: vi.fn().mockResolvedValue({
          id: "b1",
          name: "GitHub Toolkit",
          description: "Search and manage repos",
          entries: [{ alias: "gh", title: "GitHub", authStrategy: "USER_SET" }],
        }),
      });
      const mw = new BundlerSystemToolsMiddleware();
      registerDiscoveryTools(mw, client);

      const result = await mw.handleOwnToolCall(
        { name: "bundler__get_bundle", arguments: { bundle_id: "b1" } },
        makeCtx()
      );

      expect(result!.isError).toBeFalsy();
      const text = (result!.content[0] as { text: string }).text;
      expect(text).toContain("GitHub Toolkit");
      expect(text).toContain("GitHub");
      expect(client.getBundle).toHaveBeenCalledWith("b1");
    });

    it("returns an error result when the bundle does not exist", async () => {
      const mw = new BundlerSystemToolsMiddleware();
      registerDiscoveryTools(mw, makeClient());

      const result = await mw.handleOwnToolCall(
        { name: "bundler__get_bundle", arguments: { bundle_id: "missing" } },
        makeCtx()
      );

      expect(result!.isError).toBe(true);
    });
  });
});

describe("DISCOVERY_RATE_LIMIT_RULES", () => {
  it("governs both discovery tool names under one shared limit", () => {
    expect(DISCOVERY_RATE_LIMIT_RULES).toHaveLength(1);
    expect(DISCOVERY_RATE_LIMIT_RULES[0].toolNames).toEqual(["bundler__search_bundles", "bundler__get_bundle"]);
    expect(DISCOVERY_RATE_LIMIT_RULES[0].maxCalls).toBeGreaterThan(0);
    expect(DISCOVERY_RATE_LIMIT_RULES[0].windowMs).toBeGreaterThan(0);
  });
});
