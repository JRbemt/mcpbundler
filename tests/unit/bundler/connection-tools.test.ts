import { describe, it, expect, vi } from "vitest";
import { BundlerSystemToolsMiddleware } from "../../../src/bundler/core/middleware/builtin-tools.js";
import { registerConnectionTools, ConnectionToolsDeps, CONNECTION_RATE_LIMIT_RULES } from "../../../src/bundler/core/middleware/connection-tools.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";
import type { MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";
import type { DiscoveryClient } from "../../../src/bundler/core/discovery/discovery-client.js";
import type { DeploymentBootstrapClient } from "../../../src/bundler/core/discovery/deployment-bootstrap-client.js";

function makeCtx(sessionId = "s1"): MiddlewareContext {
  return {
    sessionId,
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

function makeDeps(overrides: Partial<ConnectionToolsDeps> = {}): ConnectionToolsDeps {
  return {
    discoveryClient: {
      searchBundles: vi.fn().mockResolvedValue([]),
      getBundle: vi.fn().mockResolvedValue({ id: "b1", name: "GitHub Toolkit", description: null, entries: [] }),
    } as unknown as DiscoveryClient,
    requestDeviceCode: vi.fn().mockResolvedValue({
      deviceCode: "dc-abc",
      userCode: "ABCD-1234",
      verificationUri: "https://keycloak.example.com/realms/mcpbundler/device",
      expiresInSeconds: 600,
      intervalSeconds: 5,
    }),
    pollDeviceToken: vi.fn().mockResolvedValue({ status: "pending" }),
    bootstrapClient: { bootstrap: vi.fn().mockResolvedValue(null) } as unknown as DeploymentBootstrapClient,
    stateStore: new InMemorySessionStateStore(),
    onConnected: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("registerConnectionTools - bundler__start_connection", () => {
  it("registers both connection tool names", () => {
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, makeDeps());
    expect(mw.getRegisteredToolNames()).toEqual(["bundler__start_connection", "bundler__check_connection_status"]);
  });

  it("returns an error when bundle_id is missing", async () => {
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, makeDeps());

    const result = await mw.handleOwnToolCall({ name: "bundler__start_connection", arguments: {} }, makeCtx());

    expect(result!.isError).toBe(true);
    expect((result!.content[0] as { text: string }).text).toContain("bundle_id");
  });

  it("returns an error when the bundle does not exist", async () => {
    const deps = makeDeps({ discoveryClient: { getBundle: vi.fn().mockResolvedValue(null), searchBundles: vi.fn() } as unknown as DiscoveryClient });
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall(
      { name: "bundler__start_connection", arguments: { bundle_id: "missing" } },
      makeCtx()
    );

    expect(result!.isError).toBe(true);
    expect((result!.content[0] as { text: string }).text).toContain("missing");
  });

  it("returns an error when the device-flow client is unavailable", async () => {
    const deps = makeDeps({ requestDeviceCode: vi.fn().mockResolvedValue(null) });
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall(
      { name: "bundler__start_connection", arguments: { bundle_id: "b1" } },
      makeCtx()
    );

    expect(result!.isError).toBe(true);
  });

  it("returns the user_code and verification_uri and stores pending state for the session", async () => {
    const deps = makeDeps();
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall(
      { name: "bundler__start_connection", arguments: { bundle_id: "b1" } },
      makeCtx("s1")
    );

    expect(result!.isError).toBeFalsy();
    const text = (result!.content[0] as { text: string }).text;
    expect(text).toContain("ABCD-1234");
    expect(text).toContain("https://keycloak.example.com/realms/mcpbundler/device");

    const stored = await deps.stateStore.get<{ bundleId: string; deviceCode: string }>(
      "s1",
      "device-flow:pending-connection"
    );
    expect(stored?.bundleId).toBe("b1");
    expect(stored?.deviceCode).toBe("dc-abc");
  });
});

describe("registerConnectionTools - bundler__check_connection_status", () => {
  async function seedPendingState(
    stateStore: InMemorySessionStateStore,
    sessionId: string,
    overrides: Partial<{
      bundleId: string;
      deviceCode: string;
      intervalSeconds: number;
      deviceExpiresAt: number;
      nextPollAllowedAt: number;
    }> = {}
  ) {
    const now = Date.now();
    await stateStore.set(sessionId, "device-flow:pending-connection", {
      bundleId: "b1",
      deviceCode: "dc-abc",
      intervalSeconds: 5,
      deviceExpiresAt: now + 600_000,
      nextPollAllowedAt: now - 1_000, // already allowed to poll
      ...overrides,
    });
  }

  it("returns an error when no connection is in progress", async () => {
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, makeDeps());

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBe(true);
    expect((result!.content[0] as { text: string }).text).toContain("bundler__start_connection");
  });

  it("reports still waiting without polling Keycloak when the throttle window has not elapsed", async () => {
    const deps = makeDeps();
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1", { nextPollAllowedAt: Date.now() + 10_000 });
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBeFalsy();
    expect((result!.content[0] as { text: string }).text.toLowerCase()).toContain("waiting");
    expect(deps.pollDeviceToken).not.toHaveBeenCalled();
  });

  it("clears state and returns an error when the device code has expired", async () => {
    const deps = makeDeps();
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1", { deviceExpiresAt: Date.now() - 1_000 });
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBe(true);
    expect(deps.pollDeviceToken).not.toHaveBeenCalled();
    expect(await deps.stateStore.get("s1", "device-flow:pending-connection")).toBeUndefined();
  });

  it("keeps state and reports still waiting on authorization_pending", async () => {
    const deps = makeDeps({ pollDeviceToken: vi.fn().mockResolvedValue({ status: "pending" }) });
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1");
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBeFalsy();
    expect((result!.content[0] as { text: string }).text.toLowerCase()).toContain("waiting");
    expect(await deps.stateStore.get("s1", "device-flow:pending-connection")).toBeDefined();
  });

  it("increases the polling interval on slow_down", async () => {
    const deps = makeDeps({ pollDeviceToken: vi.fn().mockResolvedValue({ status: "slow_down" }) });
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1", { intervalSeconds: 5 });
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    const stored = await deps.stateStore.get<{ intervalSeconds: number }>("s1", "device-flow:pending-connection");
    expect(stored?.intervalSeconds).toBe(10);
  });

  it("clears state and returns an error on access_denied", async () => {
    const deps = makeDeps({ pollDeviceToken: vi.fn().mockResolvedValue({ status: "denied" }) });
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1");
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBe(true);
    expect((result!.content[0] as { text: string }).text.toLowerCase()).toContain("denied");
    expect(await deps.stateStore.get("s1", "device-flow:pending-connection")).toBeUndefined();
  });

  it("clears state and returns an error on expired_token from the poll", async () => {
    const deps = makeDeps({ pollDeviceToken: vi.fn().mockResolvedValue({ status: "expired" }) });
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1");
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBe(true);
    expect(await deps.stateStore.get("s1", "device-flow:pending-connection")).toBeUndefined();
  });

  it("clears state and returns an error when approved but bootstrap fails", async () => {
    const deps = makeDeps({
      pollDeviceToken: vi.fn().mockResolvedValue({ status: "approved", accessToken: "keycloak-jwt" }),
      bootstrapClient: { bootstrap: vi.fn().mockResolvedValue(null) } as unknown as DeploymentBootstrapClient,
    });
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1");
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBe(true);
    expect(deps.onConnected).not.toHaveBeenCalled();
    expect(await deps.stateStore.get("s1", "device-flow:pending-connection")).toBeUndefined();
  });

  it("clears state, calls onConnected, and reports success when status is ready", async () => {
    const deps = makeDeps({
      pollDeviceToken: vi.fn().mockResolvedValue({ status: "approved", accessToken: "keycloak-jwt" }),
      bootstrapClient: {
        bootstrap: vi.fn().mockResolvedValue({ status: "ready", token: "mcp_sk_live_abc", missingCredentials: [] }),
      } as unknown as DeploymentBootstrapClient,
    });
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1", { bundleId: "b1" });
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBeFalsy();
    expect((result!.content[0] as { text: string }).text).toContain("b1");
    expect(deps.bootstrapClient.bootstrap).toHaveBeenCalledWith("keycloak-jwt", "b1");
    expect(deps.onConnected).toHaveBeenCalledWith("s1", "b1", "mcp_sk_live_abc");
    expect(await deps.stateStore.get("s1", "device-flow:pending-connection")).toBeUndefined();
  });

  it("returns a clean isError result instead of propagating when onConnected throws after a successful approval", async () => {
    const deps = makeDeps({
      pollDeviceToken: vi.fn().mockResolvedValue({ status: "approved", accessToken: "keycloak-jwt" }),
      bootstrapClient: {
        bootstrap: vi.fn().mockResolvedValue({ status: "ready", token: "mcp_sk_live_abc", missingCredentials: [] }),
      } as unknown as DeploymentBootstrapClient,
      onConnected: vi.fn().mockRejectedValue(new Error("resolveBundle: internal secret-store DSN unreachable")),
    });
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1", { bundleId: "b1" });
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBe(true);
    const text = (result!.content[0] as { text: string }).text;
    expect(text).not.toContain("internal secret-store DSN unreachable");
    expect(text.toLowerCase()).toContain("could not attach");
  });

  it("still calls onConnected (partial deployment isn't blocked) and reports which credentials are still missing when status is needs_credentials", async () => {
    const deps = makeDeps({
      pollDeviceToken: vi.fn().mockResolvedValue({ status: "approved", accessToken: "keycloak-jwt" }),
      bootstrapClient: {
        bootstrap: vi.fn().mockResolvedValue({
          status: "needs_credentials",
          token: "mcp_sk_live_abc",
          missingCredentials: [{ entryId: "e1", alias: "gh", entryTitle: "GitHub", mcpNamespace: "github" }],
        }),
      } as unknown as DeploymentBootstrapClient,
    });
    await seedPendingState(deps.stateStore as InMemorySessionStateStore, "s1", { bundleId: "b1" });
    const mw = new BundlerSystemToolsMiddleware();
    registerConnectionTools(mw, deps);

    const result = await mw.handleOwnToolCall({ name: "bundler__check_connection_status", arguments: {} }, makeCtx("s1"));

    expect(result!.isError).toBeFalsy();
    expect((result!.content[0] as { text: string }).text).toContain("GitHub");
    expect(deps.onConnected).toHaveBeenCalledWith("s1", "b1", "mcp_sk_live_abc");
    expect(await deps.stateStore.get("s1", "device-flow:pending-connection")).toBeUndefined();
  });
});

describe("CONNECTION_RATE_LIMIT_RULES", () => {
  it("governs bundler__start_connection and bundler__check_connection_status under separate limits", () => {
    expect(CONNECTION_RATE_LIMIT_RULES).toHaveLength(2);

    const startRule = CONNECTION_RATE_LIMIT_RULES.find((r) => r.toolNames.includes("bundler__start_connection"));
    expect(startRule?.toolNames).toEqual(["bundler__start_connection"]);
    expect(startRule?.maxCalls).toBeGreaterThan(0);
    expect(startRule?.windowMs).toBeGreaterThan(0);

    const statusRule = CONNECTION_RATE_LIMIT_RULES.find((r) => r.toolNames.includes("bundler__check_connection_status"));
    expect(statusRule?.toolNames).toEqual(["bundler__check_connection_status"]);
    expect(statusRule?.maxCalls).toBeGreaterThan(0);
    expect(statusRule?.windowMs).toBeGreaterThan(0);

    // start_connection mints a real Keycloak device code per call and must
    // be the stricter of the two - see CONNECTION_RATE_LIMIT_RULES's own
    // rationale above.
    expect(startRule!.maxCalls).toBeLessThan(statusRule!.maxCalls);
  });
});
