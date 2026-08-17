import { describe, it, expect, vi, afterEach } from "vitest";
import { DiscoveryClient } from "../../../src/bundler/core/discovery/discovery-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

vi.mock("../../../src/bundler/core/discovery/service-token.js", () => ({
  getServiceToken: vi.fn().mockResolvedValue("svc-token-abc"),
}));

describe("DiscoveryClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("searchBundles", () => {
    it("maps backend PublicBundleSummaryOut items to PublicBundleSummary", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            {
              id: "b1",
              name: "GitHub Toolkit",
              description: "Search and manage repos",
              owner_id: "u1",
              owner_name: "acme",
              mcp_count: 2,
              deployment_count: 5,
              fork_count: 1,
              tags: ["dev"],
              entry_previews: [{ alias: "gh", title: "GitHub" }],
            },
          ],
          page: 1,
          page_size: 20,
          has_next: false,
          has_previous: false,
          total_pages: 1,
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new DiscoveryClient("http://backend.local");
      const results = await client.searchBundles("github");

      expect(results).toEqual([
        {
          id: "b1",
          name: "GitHub Toolkit",
          description: "Search and manage repos",
          ownerName: "acme",
          mcpCount: 2,
          tags: ["dev"],
          entryPreviews: [{ alias: "gh", title: "GitHub" }],
        },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        "http://backend.local/v1/discover/bundles?_count=20",
        expect.objectContaining({
          headers: { Authorization: "Bearer svc-token-abc" },
        })
      );
    });

    it("returns an empty array when the backend request fails", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
      const client = new DiscoveryClient("http://backend.local");
      expect(await client.searchBundles("anything")).toEqual([]);
    });

    it("sends no Authorization header when no service token is available", async () => {
      const { getServiceToken } = await import("../../../src/bundler/core/discovery/service-token.js");
      vi.mocked(getServiceToken).mockResolvedValueOnce(null);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
      vi.stubGlobal("fetch", fetchMock);

      const client = new DiscoveryClient("http://backend.local");
      await client.searchBundles("anything");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://backend.local/v1/discover/bundles?_count=20",
        expect.objectContaining({ headers: {} })
      );
    });
  });

  describe("getBundle", () => {
    it("maps a backend PublicBundleOut to PublicBundleDetail", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          id: "b1",
          name: "GitHub Toolkit",
          description: "Search and manage repos",
          created_at: "2026-01-01T00:00:00Z",
          entries: [
            { id: "e1", listing_id: "l1", alias: "gh", auth_strategy: "USER_SET", listing: { title: "GitHub" } },
          ],
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const client = new DiscoveryClient("http://backend.local");
      const bundle = await client.getBundle("b1");

      expect(bundle).toEqual({
        id: "b1",
        name: "GitHub Toolkit",
        description: "Search and manage repos",
        entries: [{ alias: "gh", title: "GitHub", authStrategy: "USER_SET" }],
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "http://backend.local/v1/bundles/public/b1",
        expect.objectContaining({ headers: { Authorization: "Bearer svc-token-abc" } })
      );
    });

    it("returns null when the bundle does not exist or is not public", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
      vi.stubGlobal("fetch", fetchMock);
      const client = new DiscoveryClient("http://backend.local");
      expect(await client.getBundle("missing")).toBeNull();
    });

    it("encodes the id when building the request URL, preventing path injection", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
      vi.stubGlobal("fetch", fetchMock);
      const client = new DiscoveryClient("http://backend.local");

      await client.getBundle("../../v1/whatever");

      expect(fetchMock).toHaveBeenCalledWith(
        "http://backend.local/v1/bundles/public/..%2F..%2Fv1%2Fwhatever",
        expect.anything()
      );
    });

    it("defaults entries to an empty array and does not throw when the response body is malformed", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: "b1", name: "Odd Bundle" })));
      const client = new DiscoveryClient("http://backend.local");

      const bundle = await client.getBundle("b1");

      expect(bundle).toEqual({ id: "b1", name: "Odd Bundle", description: null, entries: [] });
    });

    it("returns null and does not throw when response.json() itself throws", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("invalid JSON");
          },
        } as unknown as Response)
      );
      const client = new DiscoveryClient("http://backend.local");

      await expect(client.getBundle("b1")).resolves.toBeNull();
    });
  });
});
