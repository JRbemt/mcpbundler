import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  bundleResourceUri,
  protectedResourceMetadataUrl,
  keycloakIssuerUrl,
} from "../../../src/bundler/core/oauth/resource-identifiers.js";

describe("resource identifiers", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BUNDLER_PUBLIC_URL = "https://connect.mcpbundler.ai";
    process.env.KEYCLOAK_SERVER_URL = "https://keycloak.example.com";
    process.env.KEYCLOAK_REALM = "mcpbundler";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("bundleResourceUri", () => {
    it("builds the per-bundle resource URI under the public base URL", () => {
      expect(bundleResourceUri("b1")).toBe("https://connect.mcpbundler.ai/mcp/b1");
    });

    it("strips a trailing slash from the configured base URL", () => {
      process.env.BUNDLER_PUBLIC_URL = "https://connect.mcpbundler.ai/";
      expect(bundleResourceUri("b1")).toBe("https://connect.mcpbundler.ai/mcp/b1");
    });

    it("URL-encodes a bundle id containing reserved characters", () => {
      expect(bundleResourceUri("b/1")).toBe("https://connect.mcpbundler.ai/mcp/b%2F1");
    });
  });

  describe("protectedResourceMetadataUrl", () => {
    it("inserts /.well-known/oauth-protected-resource before the resource's path, per RFC 9728", () => {
      expect(protectedResourceMetadataUrl("b1")).toBe(
        "https://connect.mcpbundler.ai/.well-known/oauth-protected-resource/mcp/b1"
      );
    });
  });

  describe("keycloakIssuerUrl", () => {
    it("builds the realm issuer URL from KEYCLOAK_SERVER_URL and KEYCLOAK_REALM", () => {
      expect(keycloakIssuerUrl()).toBe("https://keycloak.example.com/realms/mcpbundler");
    });

    it("strips a trailing slash from KEYCLOAK_SERVER_URL", () => {
      process.env.KEYCLOAK_SERVER_URL = "https://keycloak.example.com/";
      expect(keycloakIssuerUrl()).toBe("https://keycloak.example.com/realms/mcpbundler");
    });
  });
});
