import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import type { ResolverService } from "../../../src/bundler/core/resolver/service.js";
import type { BundlerConfig } from "../../../src/bundler/core/schemas.js";

// Route-level coverage for the bundle-scoped /mcp/:bundleId variants added
// alongside the bare /mcp routes: the no-token initialize branch diverges
// from the anonymous session (returns a 401 + WWW-Authenticate pointing at
// this bundle's Protected Resource Metadata document per RFC 9728), and the
// three verbs must be registered without letting :bundleId capture the
// literal /mcp/middleware routes that sit ahead of them.

function makeConfig(): BundlerConfig {
  return {
    name: "test-bundler",
    version: "0.0.0",
    host: "0.0.0.0",
    port: 0,
    concurrency: { max_concurrent: 10 },
  } as unknown as BundlerConfig;
}

function makeResolver(): ResolverService {
  return { resolveBundle: vi.fn() } as unknown as ResolverService;
}

async function startServer(bundler: BundlerServer): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(bundler.getApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function initializeRequestBody() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

describe("POST /mcp/:bundleId - bundle-scoped OAuth discovery", () => {
  let bundler: BundlerServer;
  let server: http.Server;
  let baseUrl: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(async () => {
    process.env.BACKEND_URL = "http://discovery-backend.example.com";
    process.env.BUNDLER_PUBLIC_URL = "https://connect.mcpbundler.ai";
    process.env.BUNDLER_NATIVE_OAUTH_ENABLED = "true";
    bundler = new BundlerServer(makeConfig(), makeResolver());
    ({ server, baseUrl } = await startServer(bundler));

    // Both grace-period gated routes reject new sessions for the first
    // second after construction (see bundler-mcp-routes.ts's
    // startupGracePeriodMs) - wait it out once rather than in every test.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }, 15000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns 401 with a WWW-Authenticate header pointing at this bundle's Protected Resource Metadata", async () => {
    const response = await fetch(`${baseUrl}/mcp/some-bundle-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="https://connect.mcpbundler.ai/.well-known/oauth-protected-resource/mcp/some-bundle-id"`
    );

    const body = await response.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error.message).toMatch(/OAuth authorization/i);
  });

  it("does not mint a session on the 401 branch", async () => {
    const before = bundler.getSessionCount();
    await fetch(`${baseUrl}/mcp/another-bundle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initializeRequestBody()),
    });
    expect(bundler.getSessionCount()).toBe(before);
  });

  it("still starts an anonymous session on the bare /mcp path with no token (no regression)", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
  });

  it("routes GET /mcp/:bundleId with no session through the shared session-lookup, not the bundleId branch", async () => {
    const response = await fetch(`${baseUrl}/mcp/some-bundle-id`, {
      method: "GET",
      headers: { Accept: "application/json, text/event-stream" },
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", error: { message: "Invalid session" } });
  });

  it("routes DELETE /mcp/:bundleId with no session through the shared session-lookup", async () => {
    const response = await fetch(`${baseUrl}/mcp/some-bundle-id`, { method: "DELETE" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ jsonrpc: "2.0", error: { message: "Invalid session" } });
  });

  it("does not let :bundleId swallow POST /mcp/middleware (registration order)", async () => {
    const response = await fetch(`${baseUrl}/mcp/middleware`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "passthrough" }),
    });

    // The real /mcp/middleware route rejects with a plain { error } body
    // when there is no valid session. If :bundleId had wrongly captured
    // this request instead, handleMcpPost's non-initialize/no-session
    // fallback would answer 400 with a JSON-RPC-shaped body instead.
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "Session not found" });
    expect(body.jsonrpc).toBeUndefined();
  });

  it("does not let :bundleId swallow DELETE /mcp/middleware/:name (registration order)", async () => {
    const response = await fetch(`${baseUrl}/mcp/middleware/passthrough`, { method: "DELETE" });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: "Session not found" });
    expect(body.jsonrpc).toBeUndefined();
  });
});

// header.payload.signature, each segment plausible base64url content - not
// a real signed token, only its shape needs to satisfy looksLikeKeycloakJwt.
const KEYCLOAK_JWT_SHAPED_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl";
const OPAQUE_BUNDLE_TOKEN = "mcp_sk_live_existingbundletoken";

describe("POST /mcp/:bundleId - Keycloak JWT to bundle token exchange", () => {
  let bundler: BundlerServer;
  let server: http.Server;
  let baseUrl: string;
  let resolver: ResolverService;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(async () => {
    process.env.BACKEND_URL = "http://discovery-backend.example.com";
    process.env.BUNDLER_PUBLIC_URL = "https://connect.mcpbundler.ai";
    process.env.BUNDLER_NATIVE_OAUTH_ENABLED = "true";
    resolver = makeResolver();
    bundler = new BundlerServer(makeConfig(), resolver);
    ({ server, baseUrl } = await startServer(bundler));
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }, 15000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = { ...ORIGINAL_ENV };
  });

  it("exchanges a JWT-shaped token for a bundle token and resolves the bundle with the exchanged token", async () => {
    const bootstrapSpy = vi
      .spyOn(bundler.getDeploymentBootstrapClient(), "bootstrap")
      .mockResolvedValue({ status: "ready", token: "mcp_sk_live_exchanged", missingCredentials: [] });
    (resolver.resolveBundle as any).mockResolvedValue({
      bundleId: "some-bundle-id",
      name: "Exchanged Bundle",
      upstreams: [],
    });

    const response = await fetch(`${baseUrl}/mcp/some-bundle-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${KEYCLOAK_JWT_SHAPED_TOKEN}`,
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(bootstrapSpy).toHaveBeenCalledWith(KEYCLOAK_JWT_SHAPED_TOKEN, "some-bundle-id");
    expect(resolver.resolveBundle).toHaveBeenCalledWith("mcp_sk_live_exchanged");
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();

    bootstrapSpy.mockRestore();
  });

  it("still resolves using the exchanged token when the bootstrap result is needs_credentials", async () => {
    const bootstrapSpy = vi.spyOn(bundler.getDeploymentBootstrapClient(), "bootstrap").mockResolvedValue({
      status: "needs_credentials",
      token: "mcp_sk_live_partial",
      missingCredentials: [{ entryId: "e1", alias: "gh", entryTitle: "GitHub", mcpNamespace: "github" }],
    });
    (resolver.resolveBundle as any).mockResolvedValue({
      bundleId: "some-bundle-id",
      name: "Partial Bundle",
      upstreams: [],
    });

    const response = await fetch(`${baseUrl}/mcp/some-bundle-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${KEYCLOAK_JWT_SHAPED_TOKEN}`,
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(resolver.resolveBundle).toHaveBeenCalledWith("mcp_sk_live_partial");
    expect(response.status).toBe(200);

    bootstrapSpy.mockRestore();
  });

  it("returns 401 with WWW-Authenticate naming the resource metadata URL when the exchange fails", async () => {
    const bootstrapSpy = vi.spyOn(bundler.getDeploymentBootstrapClient(), "bootstrap").mockResolvedValue(null);
    (resolver.resolveBundle as any).mockClear();

    const response = await fetch(`${baseUrl}/mcp/some-bundle-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${KEYCLOAK_JWT_SHAPED_TOKEN}`,
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer error="invalid_token", error_description="Could not exchange authorization for a bundle token", resource_metadata="https://connect.mcpbundler.ai/.well-known/oauth-protected-resource/mcp/some-bundle-id"`
    );
    const body = await response.json();
    expect(body.error.message).toMatch(/could not exchange/i);
    expect(resolver.resolveBundle).not.toHaveBeenCalled();

    bootstrapSpy.mockRestore();
  });

  it("does not attempt an exchange for a non-JWT-shaped opaque bundle token", async () => {
    const bootstrapSpy = vi.spyOn(bundler.getDeploymentBootstrapClient(), "bootstrap");
    (resolver.resolveBundle as any).mockResolvedValue({
      bundleId: "some-bundle-id",
      name: "Direct Bundle",
      upstreams: [],
    });

    const response = await fetch(`${baseUrl}/mcp/some-bundle-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${OPAQUE_BUNDLE_TOKEN}`,
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(resolver.resolveBundle).toHaveBeenCalledWith(OPAQUE_BUNDLE_TOKEN);
    expect(response.status).toBe(200);

    bootstrapSpy.mockRestore();
  });

  it("does not attempt an exchange for a JWT-shaped token on the bare /mcp path (no bundleIdHint to bootstrap against)", async () => {
    const bootstrapSpy = vi.spyOn(bundler.getDeploymentBootstrapClient(), "bootstrap");
    (resolver.resolveBundle as any).mockResolvedValue({
      bundleId: "whatever-the-token-resolves-to",
      name: "Bare Path Bundle",
      upstreams: [],
    });

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${KEYCLOAK_JWT_SHAPED_TOKEN}`,
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(resolver.resolveBundle).toHaveBeenCalledWith(KEYCLOAK_JWT_SHAPED_TOKEN);
    expect(response.status).toBe(200);

    bootstrapSpy.mockRestore();
  });
});

describe("POST /mcp/:bundleId - no discovery backend configured", () => {
  let bundler: BundlerServer;
  let server: http.Server;
  let baseUrl: string;
  const ORIGINAL_ENV = { ...process.env };

  beforeAll(async () => {
    delete process.env.BACKEND_URL;
    process.env.BUNDLER_PUBLIC_URL = "https://connect.mcpbundler.ai";
    process.env.BUNDLER_NATIVE_OAUTH_ENABLED = "true";
    bundler = new BundlerServer(makeConfig(), makeResolver());
    ({ server, baseUrl } = await startServer(bundler));
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }, 15000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = { ...ORIGINAL_ENV };
  });

  it("still returns 401 with Protected Resource Metadata on a bundle-scoped URI even without a discovery backend", async () => {
    // The bundleIdHint branch is orthogonal to anonymous-session discovery
    // gating: a bundle-scoped resource URI always has something specific
    // to authorize for, regardless of whether anonymous discovery sessions
    // are available on the bare /mcp path.
    const response = await fetch(`${baseUrl}/mcp/some-bundle-id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("still falls back to plain 401 with no Protected Resource Metadata on the bare /mcp path", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initializeRequestBody()),
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });
});
