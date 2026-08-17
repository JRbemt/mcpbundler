import { describe, it, expect, vi } from "vitest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import type { ResolverService } from "../../../src/bundler/core/resolver/service.js";
import type { BundlerConfig } from "../../../src/bundler/core/schemas.js";

function makeConfig(): BundlerConfig {
  return {
    name: "test-bundler",
    version: "0.0.0",
    host: "0.0.0.0",
    port: 0,
    concurrency: { max_concurrent: 10 },
    loading_strategy: "eager",
  } as unknown as BundlerConfig;
}

function makeResolver(): ResolverService {
  return { resolveBundle: vi.fn() } as unknown as ResolverService;
}

describe("BundlerServer connection tools wiring", () => {
  it("registers all four anonymous tools, including the two connection tools, when the device-flow flag is on", async () => {
    process.env.BUNDLER_DEVICE_FLOW_ENABLED = "true";
    try {
      const bundler = new BundlerServer(makeConfig(), makeResolver());
      const session = bundler.createAnonymousSession("anon-1");

      const { tools } = await session.listTools();
      const names = tools.map((t) => t.name);

      expect(names).toContain("bundler__search_bundles");
      expect(names).toContain("bundler__get_bundle");
      expect(names).toContain("bundler__start_connection");
      expect(names).toContain("bundler__check_connection_status");
    } finally {
      delete process.env.BUNDLER_DEVICE_FLOW_ENABLED;
    }
  });

  it("omits the two connection tools when the device-flow flag is off (default)", async () => {
    delete process.env.BUNDLER_DEVICE_FLOW_ENABLED;
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-1b");

    const { tools } = await session.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain("bundler__search_bundles");
    expect(names).toContain("bundler__get_bundle");
    expect(names).not.toContain("bundler__start_connection");
    expect(names).not.toContain("bundler__check_connection_status");
  });

  it("resolves the bundle token and transitions the session to a bundle stage when a connection completes", async () => {
    const resolver = makeResolver();
    (resolver.resolveBundle as any).mockResolvedValue({
      bundleId: "b1",
      name: "GitHub Toolkit",
      upstreams: [],
      router: undefined,
    });
    const bundler = new BundlerServer(makeConfig(), resolver);
    const session = bundler.createAnonymousSession("anon-2");
    bundler.addSession("anon-2", session);
    // Spies on Session.transitionTo directly rather than
    // BundlerServer.transitionSessionToStage, since the latter is expected
    // to be a thin lookup-then-delegate (same shape as the existing
    // addMiddlewareToSession/removeMiddlewareFromSession), matching
    // bundler-staging.md's own description. If that plan's actual
    // implementation does more than delegate to session.transitionTo,
    // adjust this spy accordingly.
    const transitionSpy = vi.spyOn(session, "transitionTo").mockResolvedValue(undefined);

    // Exercises the private wiring method directly - Task 4's tests already
    // cover connection-tools.ts's own branch logic (when onConnected gets
    // called and with what arguments); this test only needs to confirm
    // BundlerServer wires that callback to a real resolve + transitionTo.
    await (bundler as any).transitionSessionToBundle("anon-2", "b1", "mcp_sk_live_abc");

    expect(resolver.resolveBundle).toHaveBeenCalledWith("mcp_sk_live_abc");
    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "bundle:b1", upstreams: [] })
    );
  });

  it("does nothing (logs, does not throw) when the session is no longer present", async () => {
    const resolver = makeResolver();
    (resolver.resolveBundle as any).mockResolvedValue({ bundleId: "b1", name: "x", upstreams: [] });
    const bundler = new BundlerServer(makeConfig(), resolver);

    await expect((bundler as any).transitionSessionToBundle("missing-session", "b1", "tok")).resolves.toBeUndefined();
  });
});
