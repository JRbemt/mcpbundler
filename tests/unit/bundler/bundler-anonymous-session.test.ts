import { describe, it, expect, vi } from "vitest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import type { ResolverService } from "../../../src/bundler/core/resolver/service.js";
import type { BundlerConfig } from "../../../src/bundler/core/schemas.js";
import { LoadingStrategy } from "../../../src/bundler/core/session/loading/loading-strategy.js";

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
  return { resolveBundle: vi.fn() };
}

describe("BundlerServer.createAnonymousSession", () => {
  it("creates a session with no bundle id, no upstreams, and the discovery tools registered", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-session-1");

    expect(session.getAllUpstreams()).toHaveLength(0);

    const { tools } = await session.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("bundler__search_bundles");
    expect(names).toContain("bundler__get_bundle");
  });

  it("registers the session so getSession/removeSession manage it like any other", () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-session-2");
    bundler.addSession("anon-session-2", session);

    expect(bundler.getSession("anon-session-2")).toBe(session);
    bundler.removeSession("anon-session-2");
    expect(bundler.getSession("anon-session-2")).toBeUndefined();
  });

  it("records an anonymous current stage carrying the installed middlewares, so a later transitionTo unloads them", () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-session-3");

    const stage = session.getCurrentStage();
    expect(stage).not.toBeNull();
    expect(stage?.name).toBe("anonymous");
    expect(stage?.upstreams).toEqual([]);
    expect(stage?.loadingStrategy).toBe(LoadingStrategy.EAGER);
    expect(stage?.middlewares.map((m) => m.name)).toEqual(session.getMiddlewareNames());
  });
});
