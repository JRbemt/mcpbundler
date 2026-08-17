import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import { DISCOVERY_RATE_LIMIT_RULES } from "../../../src/bundler/core/middleware/discovery-tools.js";
import type { ResolverService } from "../../../src/bundler/core/resolver/service.js";
import type { BundlerConfig } from "../../../src/bundler/core/schemas.js";

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

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("BundlerServer.createAnonymousSession - discovery rate limiting", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ items: [] })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects bundler__search_bundles once the shared discovery limit is exceeded within the window", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-rl-1");
    bundler.addSession("anon-rl-1", session);

    const maxCalls = DISCOVERY_RATE_LIMIT_RULES[0].maxCalls;
    for (let i = 0; i < maxCalls; i++) {
      const result = await session.callTool({ name: "bundler__search_bundles", arguments: { query: "x" } });
      expect(result.isError).toBeFalsy();
    }

    const limited = await session.callTool({ name: "bundler__search_bundles", arguments: { query: "x" } });
    expect(limited.isError).toBe(true);
    expect((limited.content[0] as { text: string }).text).toContain("Rate limit exceeded");
  });

  it("counts bundler__get_bundle calls against the same shared limit as bundler__search_bundles", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-rl-2");
    bundler.addSession("anon-rl-2", session);

    const maxCalls = DISCOVERY_RATE_LIMIT_RULES[0].maxCalls;
    for (let i = 0; i < maxCalls; i++) {
      await session.callTool({ name: "bundler__get_bundle", arguments: { bundle_id: "b1" } });
    }

    const limited = await session.callTool({ name: "bundler__search_bundles", arguments: { query: "x" } });
    expect(limited.isError).toBe(true);
  });

  it("does not misclassify an unrelated tool call as rate limited", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-rl-3");
    bundler.addSession("anon-rl-3", session);

    // Not a discovery tool, so the rate limiter must defer (return null) and
    // let the call fall through to normal namespace routing, which errors
    // for its own unrelated reason (no upstream owns this name) - the point
    // of this test is that the error is NOT a rate-limit rejection.
    const result = await session.callTool({ name: "not_a_real_tool", arguments: {} });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).not.toContain("Rate limit exceeded");
  });
});
