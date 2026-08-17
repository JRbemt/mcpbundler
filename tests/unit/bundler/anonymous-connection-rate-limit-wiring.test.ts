import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import { CONNECTION_RATE_LIMIT_RULES } from "../../../src/bundler/core/middleware/connection-tools.js";
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

describe("BundlerServer.createAnonymousSession - connection rate limiting", () => {
  // The rate limiter rules match tool names regardless of registration, but
  // these tests are about the connection tools specifically - enabling the
  // flag exercises the same code path a real deployment would run rather
  // than a rate limiter matching against tool names systemTools never
  // registered.
  beforeEach(() => {
    process.env.BUNDLER_DEVICE_FLOW_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.BUNDLER_DEVICE_FLOW_ENABLED;
  });

  it("rejects bundler__start_connection once its limit is exceeded within the window", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-conn-rl-1");
    bundler.addSession("anon-conn-rl-1", session);

    const rule = CONNECTION_RATE_LIMIT_RULES.find((r) => r.toolNames.includes("bundler__start_connection"))!;
    for (let i = 0; i < rule.maxCalls; i++) {
      // bundle_id doesn't need to resolve to a real bundle - discoveryClient.getBundle
      // will fail closed (no backend reachable in this test) and the call still counts
      // against the limit, which is what this test is checking.
      await session.callTool({ name: "bundler__start_connection", arguments: { bundle_id: "b1" } });
    }

    const limited = await session.callTool({ name: "bundler__start_connection", arguments: { bundle_id: "b1" } });
    expect(limited.isError).toBe(true);
    expect((limited.content[0] as { text: string }).text).toContain("Rate limit exceeded");
  });

  it("rejects bundler__check_connection_status once its own, separate limit is exceeded within the window", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-conn-rl-2");
    bundler.addSession("anon-conn-rl-2", session);

    const rule = CONNECTION_RATE_LIMIT_RULES.find((r) => r.toolNames.includes("bundler__check_connection_status"))!;
    for (let i = 0; i < rule.maxCalls; i++) {
      await session.callTool({ name: "bundler__check_connection_status", arguments: {} });
    }

    const limited = await session.callTool({ name: "bundler__check_connection_status", arguments: {} });
    expect(limited.isError).toBe(true);
    expect((limited.content[0] as { text: string }).text).toContain("Rate limit exceeded");
  });

  it("does not count bundler__start_connection calls against bundler__check_connection_status's limit or vice versa", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createAnonymousSession("anon-conn-rl-3");
    bundler.addSession("anon-conn-rl-3", session);

    const startRule = CONNECTION_RATE_LIMIT_RULES.find((r) => r.toolNames.includes("bundler__start_connection"))!;
    for (let i = 0; i < startRule.maxCalls; i++) {
      await session.callTool({ name: "bundler__start_connection", arguments: { bundle_id: "b1" } });
    }

    // No real Keycloak/backend is reachable in this test, so none of the
    // start_connection calls above actually established pending-connection
    // state - the call below still hits check_connection_status's own
    // "No connection is in progress" business-logic error (see Task 4),
    // which is a legitimate non-rate-limit isError: true. What this test
    // checks is narrower: that exhausting start_connection's limit did not
    // ALSO trip check_connection_status's separate limit - i.e. the call
    // was not rejected by the rate limiter itself.
    const stillAllowed = await session.callTool({ name: "bundler__check_connection_status", arguments: {} });
    expect((stillAllowed.content[0] as { text: string }).text).not.toContain("Rate limit exceeded");
  });
});
