import { describe, it, expect, vi } from "vitest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import type { ResolverService } from "../../../src/bundler/core/resolver/service.js";
import type { BundlerConfig } from "../../../src/bundler/core/schemas.js";
import { LoadingStrategy } from "../../../src/bundler/core/session/loading/loading-strategy.js";
import type { BundlerStage } from "../../../src/bundler/core/session/stage.js";

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

function makeStage(): BundlerStage {
  return { name: "bundle:b1", middlewares: [], upstreams: [], loadingStrategy: LoadingStrategy.EAGER };
}

describe("BundlerServer.transitionSessionToStage", () => {
  it("returns false for an unknown session", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    expect(await bundler.transitionSessionToStage("missing", makeStage())).toBe(false);
  });

  it("delegates to the session's transitionTo and returns true", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createSession("s1", "b0", "tok", []);
    bundler.addSession("s1", session);

    const stage = makeStage();
    const result = await bundler.transitionSessionToStage("s1", stage);

    expect(result).toBe(true);
    expect(session.getCurrentStage()).toBe(stage);
  });
});
