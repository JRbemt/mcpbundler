import { describe, it, expect, vi } from "vitest";
import { Session, SessionState } from "../../../src/bundler/core/session/session.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";
import { AbstractBundlerMiddleware } from "../../../src/bundler/core/middleware/middleware.js";
import { LoadingStrategy } from "../../../src/bundler/core/session/loading/loading-strategy.js";
import type { BundlerStage } from "../../../src/bundler/core/session/stage.js";
import { createMCPConfig } from "../../helpers/fixtures.js";
import { attachStageUpstreams } from "../../../src/bundler/core/session/loading/attach-stage-upstreams.js";

// The default mock implementation delegates to the real attachStageUpstreams
// so every existing test in this file keeps exercising the actual
// unload/load/attach sequence. Only the ordering regression test below
// overrides this with a controllable, delayed promise via
// mockImplementationOnce - every other call falls through to `actual`.
vi.mock("../../../src/bundler/core/session/loading/attach-stage-upstreams.js", async () => {
  const actual = await vi.importActual<typeof import("../../../src/bundler/core/session/loading/attach-stage-upstreams.js")>(
    "../../../src/bundler/core/session/loading/attach-stage-upstreams.js"
  );
  return {
    ...actual,
    attachStageUpstreams: vi.fn(actual.attachStageUpstreams),
  };
});

class SpyMiddleware extends AbstractBundlerMiddleware {
  constructor(readonly name: string) { super(); }
  teardownSpy = vi.fn(async () => { });
  override async teardown() { return this.teardownSpy(); }
}

function makeSession(): Session {
  const now = new Date();
  return new Session(
    "s1", "anonymous", "", now,
    null, null, null, null,
    now, SessionState.Active, new InMemorySessionStateStore()
  );
}

function makeStage(overrides: Partial<BundlerStage> = {}): BundlerStage {
  return {
    name: "test-stage",
    middlewares: [],
    upstreams: [],
    loadingStrategy: LoadingStrategy.EAGER,
    ...overrides,
  };
}

describe("Session.setCurrentStage", () => {
  it("records the stage and its loading strategy without touching middlewares", () => {
    const session = makeSession();
    const stage = makeStage({ name: "anonymous", loadingStrategy: LoadingStrategy.PROGRESSIVE });

    session.setCurrentStage(stage);

    expect(session.getCurrentStage()).toBe(stage);
    expect(session.getLoadingStrategy()).toBe(LoadingStrategy.PROGRESSIVE);
    expect(session.getMiddlewareNames()).toEqual([]);
  });
});

describe("Session.transitionTo", () => {
  it("installs the new stage's middlewares", async () => {
    const session = makeSession();
    const mw = new SpyMiddleware("discovery-tools");

    await session.transitionTo(makeStage({ middlewares: [mw] }));

    expect(session.getMiddlewareNames()).toEqual(["discovery-tools"]);
  });

  it("does nothing to unload on the first transition (no previous stage)", async () => {
    const session = makeSession();
    await expect(session.transitionTo(makeStage())).resolves.not.toThrow();
  });

  it("unloads the previous stage's middlewares (via removeMiddleware's teardown) before loading the new ones", async () => {
    const session = makeSession();
    const anonMw = new SpyMiddleware("discovery-tools");
    const bundleMw = new SpyMiddleware("bundle-tools");

    await session.transitionTo(makeStage({ name: "anonymous", middlewares: [anonMw] }));
    await session.transitionTo(makeStage({ name: "bundle:b1", middlewares: [bundleMw] }));

    expect(anonMw.teardownSpy).toHaveBeenCalledOnce();
    expect(session.getMiddlewareNames()).toEqual(["bundle-tools"]);
  });

  it("unloads a stage that was recorded via setCurrentStage rather than a prior transitionTo call", async () => {
    const session = makeSession();
    const anonMw = new SpyMiddleware("discovery-tools");
    session.addMiddleware(anonMw);
    session.setCurrentStage(makeStage({ name: "anonymous", middlewares: [anonMw] }));

    await session.transitionTo(makeStage({ name: "bundle:b1", middlewares: [new SpyMiddleware("bundle-tools")] }));

    expect(anonMw.teardownSpy).toHaveBeenCalledOnce();
    expect(session.getMiddlewareNames()).toEqual(["bundle-tools"]);
  });

  it("records the new stage and adopts its loading strategy", async () => {
    const session = makeSession();
    const stage = makeStage({ name: "bundle:b1", loadingStrategy: LoadingStrategy.PROGRESSIVE });

    await session.transitionTo(stage);

    expect(session.getCurrentStage()).toBe(stage);
    expect(session.getLoadingStrategy()).toBe(LoadingStrategy.PROGRESSIVE);
  });

  it("emits list_changed after the middleware swap", async () => {
    const session = makeSession();
    const handler = vi.fn();
    session.on("notify_tools_changed", handler);

    await session.transitionTo(makeStage({ middlewares: [new SpyMiddleware("a")] }));

    expect(handler).toHaveBeenCalled();
  });

  it("does not emit list_changed until attachStageUpstreams resolves (regression guard: the emit must stay below the await)", async () => {
    const session = makeSession();
    const handler = vi.fn();
    session.on("notify_tools_changed", handler);

    // Replace attachStageUpstreams with a promise we control the resolution
    // of, so we can observe whether the notification fires while it is
    // still pending. If transitionTo ever moves emitListChanged() above
    // `await attachStageUpstreams(...)`, this handler will have already
    // been called at the "still pending" assertion below.
    let resolveAttach: () => void = () => { throw new Error("resolveAttach not assigned"); };
    const pendingAttach = new Promise<void>((resolve) => { resolveAttach = resolve; });
    vi.mocked(attachStageUpstreams).mockImplementationOnce(() => pendingAttach);

    const transitionPromise = session.transitionTo(makeStage({ middlewares: [new SpyMiddleware("a")] }));

    // Flush pending microtasks (including the synchronous portion of
    // transitionTo up to its `await attachStageUpstreams(...)` line)
    // without resolving attachStageUpstreams itself.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();

    resolveAttach();
    await transitionPromise;

    expect(handler).toHaveBeenCalled();
  });

  it("attaches the new stage's upstreams", async () => {
    const session = makeSession();
    const attachSpy = vi.spyOn(session, "attachUpstream").mockResolvedValue(undefined);
    const upstream = createMCPConfig({ namespace: "github" });

    await session.transitionTo(makeStage({ upstreams: [upstream] }));

    expect(attachSpy).toHaveBeenCalledWith(upstream);
  });

  it("logs but does not throw when the outgoing stage still has upstreams (teardown not implemented - scope boundary)", async () => {
    const session = makeSession();
    vi.spyOn(session, "attachUpstream").mockResolvedValue(undefined);
    const staleUpstream = createMCPConfig({ namespace: "stale" });

    await session.transitionTo(makeStage({ name: "stage-a", upstreams: [staleUpstream] }));

    await expect(
      session.transitionTo(makeStage({ name: "stage-b", upstreams: [] }))
    ).resolves.not.toThrow();
  });

  it("throws if the session is not active", async () => {
    const session = makeSession();
    await session.close();

    await expect(session.transitionTo(makeStage())).rejects.toThrow("Session is not active");
  });
});
