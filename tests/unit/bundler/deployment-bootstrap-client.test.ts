import { describe, it, expect, vi, afterEach } from "vitest";
import { DeploymentBootstrapClient } from "../../../src/bundler/core/discovery/deployment-bootstrap-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("DeploymentBootstrapClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the Keycloak access token and bundle id, returning a ready result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        deployment_id: "d1",
        bundle_id: "b1",
        status: "ready",
        token: { id: "t1", name: "agent-bootstrap", value: "mcp_sk_live_abc", created_at: "2026-08-09T12:00:00Z", expires_at: null },
        missing_credentials: [],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeploymentBootstrapClient("http://backend.local");
    const result = await client.bootstrap("keycloak-jwt-xyz", "b1");

    expect(result).toEqual({ status: "ready", token: "mcp_sk_live_abc", missingCredentials: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://backend.local/v1/deployments/bootstrap",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer keycloak-jwt-xyz",
        }),
        body: JSON.stringify({ bundle_id: "b1" }),
      })
    );
  });

  it("maps a needs_credentials response, including the still-present token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        deployment_id: "d1",
        bundle_id: "b1",
        status: "needs_credentials",
        token: { id: "t1", name: "agent-bootstrap", value: "mcp_sk_live_abc", created_at: "2026-08-09T12:00:00Z", expires_at: null },
        missing_credentials: [{ entry_id: "e1", alias: "gh", entry_title: "GitHub", mcp_namespace: "github" }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeploymentBootstrapClient("http://backend.local");
    const result = await client.bootstrap("keycloak-jwt-xyz", "b1");

    expect(result).toEqual({
      status: "needs_credentials",
      token: "mcp_sk_live_abc",
      missingCredentials: [{ entryId: "e1", alias: "gh", entryTitle: "GitHub", mcpNamespace: "github" }],
    });
  });

  it("returns null when the backend request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const client = new DeploymentBootstrapClient("http://backend.local");
    expect(await client.bootstrap("keycloak-jwt-xyz", "b1")).toBeNull();
  });

  it("returns null when the request throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const client = new DeploymentBootstrapClient("http://backend.local");
    expect(await client.bootstrap("keycloak-jwt-xyz", "b1")).toBeNull();
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
    const client = new DeploymentBootstrapClient("http://backend.local");

    await expect(client.bootstrap("keycloak-jwt-xyz", "b1")).resolves.toBeNull();
  });
});
