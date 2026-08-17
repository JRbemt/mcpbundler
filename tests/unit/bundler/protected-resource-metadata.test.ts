import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildProtectedResourceMetadata } from "../../../src/bundler/core/oauth/protected-resource-metadata.js";

describe("buildProtectedResourceMetadata", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.BUNDLER_PUBLIC_URL = "https://connect.mcpbundler.ai";
    process.env.KEYCLOAK_SERVER_URL = "https://keycloak.example.com";
    process.env.KEYCLOAK_REALM = "mcpbundler";
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns a resource pointing at the bundle's own resource URI", () => {
    const metadata = buildProtectedResourceMetadata("b1");
    expect(metadata.resource).toBe("https://connect.mcpbundler.ai/mcp/b1");
  });

  it("lists Keycloak's realm issuer as the sole authorization server", () => {
    const metadata = buildProtectedResourceMetadata("b1");
    expect(metadata.authorization_servers).toEqual(["https://keycloak.example.com/realms/mcpbundler"]);
  });

  it("declares header-based bearer token delivery", () => {
    const metadata = buildProtectedResourceMetadata("b1");
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });
});
