import { describe, it, expect, vi, afterEach } from "vitest";
import { APIBundleResolver } from "../../../src/bundler/core/resolver/api-bundle-resolver.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("APIBundleResolver", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips a malformed MCP entry instead of failing the whole bundle", async () => {
    const validEntry = {
      namespace: "github",
      url: "https://github-mcp.example.com",
      authStrategy: "MASTER",
      auth: { method: "bearer", token: "tok-abc" },
    };
    // Mirrors the oauth2_cc bug: a bearer auth entry with no token, which the
    // MCPAuthConfigSchema discriminated union rejects (token must be a string).
    const malformedEntry = {
      namespace: "broken-oauth",
      url: "https://broken.example.com",
      authStrategy: "USER_SET",
      auth: { method: "bearer", token: null },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          bundleId: "b1",
          name: "test-bundle",
          mcps: [validEntry, malformedEntry],
        })
      )
    );

    const resolver = new APIBundleResolver("http://backend.local");
    const bundle = await resolver.resolveBundle("mcpb_test_token");

    expect(bundle.upstreams).toHaveLength(1);
    expect(bundle.upstreams[0].namespace).toBe("github");
  });

  it("passes an abort signal so a hung backend does not block forever", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ bundleId: "b1", name: "test-bundle", mcps: [] })
    );
    vi.stubGlobal("fetch", fetchMock);

    const resolver = new APIBundleResolver("http://backend.local");
    await resolver.resolveBundle("mcpb_test_token");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.local/v1/bundler/resolve",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
