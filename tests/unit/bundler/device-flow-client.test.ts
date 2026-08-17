import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { requestDeviceCode, pollDeviceToken } from "../../../src/bundler/core/discovery/device-flow-client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("device-flow-client", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.KEYCLOAK_SERVER_URL = "https://keycloak.example.com";
    process.env.KEYCLOAK_REALM = "mcpbundler";
    process.env.BUNDLER_DEVICEFLOW_KEYCLOAK_CLIENT_ID = "bundler-deviceflow";
    process.env.BUNDLER_DEVICEFLOW_KEYCLOAK_CLIENT_SECRET = "secret-value";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  describe("requestDeviceCode", () => {
    it("returns null when the device-flow client is not configured", async () => {
      delete process.env.BUNDLER_DEVICEFLOW_KEYCLOAK_CLIENT_ID;
      expect(await requestDeviceCode()).toBeNull();
    });

    it("posts to Keycloak's device-authorization endpoint and maps the response", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({
          device_code: "dc-abc",
          user_code: "ABCD-1234",
          verification_uri: "https://keycloak.example.com/realms/mcpbundler/device",
          verification_uri_complete: "https://keycloak.example.com/realms/mcpbundler/device?user_code=ABCD-1234",
          expires_in: 600,
          interval: 5,
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const result = await requestDeviceCode();

      expect(result).toEqual({
        deviceCode: "dc-abc",
        userCode: "ABCD-1234",
        verificationUri: "https://keycloak.example.com/realms/mcpbundler/device",
        verificationUriComplete: "https://keycloak.example.com/realms/mcpbundler/device?user_code=ABCD-1234",
        expiresInSeconds: 600,
        intervalSeconds: 5,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://keycloak.example.com/realms/mcpbundler/protocol/openid-connect/auth/device",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
      );
      const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(body.get("client_id")).toBe("bundler-deviceflow");
      expect(body.get("client_secret")).toBe("secret-value");
    });

    it("returns null when Keycloak responds with a non-2xx status", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 500)));
      expect(await requestDeviceCode()).toBeNull();
    });

    it("returns null when the response is missing required fields", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ device_code: "dc-abc" })));
      expect(await requestDeviceCode()).toBeNull();
    });
  });

  describe("pollDeviceToken", () => {
    it("posts the device_code grant to Keycloak's token endpoint", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ access_token: "jwt-xyz", token_type: "Bearer", expires_in: 300 })
      );
      vi.stubGlobal("fetch", fetchMock);

      await pollDeviceToken("dc-abc");

      expect(fetchMock).toHaveBeenCalledWith(
        "https://keycloak.example.com/realms/mcpbundler/protocol/openid-connect/token",
        expect.objectContaining({ method: "POST" })
      );
      const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
      expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:device_code");
      expect(body.get("device_code")).toBe("dc-abc");
      expect(body.get("client_id")).toBe("bundler-deviceflow");
    });

    it("maps a successful response to status approved with the access token", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ access_token: "jwt-xyz" })));
      expect(await pollDeviceToken("dc-abc")).toEqual({ status: "approved", accessToken: "jwt-xyz" });
    });

    it("maps authorization_pending to status pending", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "authorization_pending" }, 400)));
      expect(await pollDeviceToken("dc-abc")).toEqual({ status: "pending" });
    });

    it("maps slow_down to status slow_down", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "slow_down" }, 400)));
      expect(await pollDeviceToken("dc-abc")).toEqual({ status: "slow_down" });
    });

    it("maps access_denied to status denied", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "access_denied" }, 400)));
      expect(await pollDeviceToken("dc-abc")).toEqual({ status: "denied" });
    });

    it("maps expired_token to status expired", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "expired_token" }, 400)));
      expect(await pollDeviceToken("dc-abc")).toEqual({ status: "expired" });
    });

    it("treats a network failure as pending rather than throwing", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
      expect(await pollDeviceToken("dc-abc")).toEqual({ status: "pending" });
    });
  });
});
