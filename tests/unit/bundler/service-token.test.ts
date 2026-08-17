import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("getServiceToken", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env.KEYCLOAK_SERVER_URL = "https://keycloak.example.com";
    process.env.KEYCLOAK_REALM = "mcpbundler";
    process.env.BUNDLER_ANON_KEYCLOAK_CLIENT_ID = "bundler-anon";
    process.env.BUNDLER_ANON_KEYCLOAK_CLIENT_SECRET = "secret-value";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns null when the anon client is not configured", async () => {
    delete process.env.BUNDLER_ANON_KEYCLOAK_CLIENT_ID;
    const { getServiceToken } = await import("../../../src/bundler/core/discovery/service-token.js");
    expect(await getServiceToken()).toBeNull();
  });

  it("requests a client_credentials token from the Keycloak realm token endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "tok-abc", expires_in: 300 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getServiceToken } = await import("../../../src/bundler/core/discovery/service-token.js");
    const token = await getServiceToken();

    expect(token).toBe("tok-abc");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://keycloak.example.com/realms/mcpbundler/protocol/openid-connect/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    );
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("bundler-anon");
    expect(body.get("client_secret")).toBe("secret-value");
  });

  it("caches the token across calls until it is near expiry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "tok-abc", expires_in: 300 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const { getServiceToken } = await import("../../../src/bundler/core/discovery/service-token.js");
    await getServiceToken();
    await getServiceToken();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns null when the token request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const { getServiceToken } = await import("../../../src/bundler/core/discovery/service-token.js");
    expect(await getServiceToken()).toBeNull();
  });

  it("returns null rather than throwing when the fetch call itself rejects (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const { getServiceToken } = await import("../../../src/bundler/core/discovery/service-token.js");
    await expect(getServiceToken()).resolves.toBeNull();
  });
});
