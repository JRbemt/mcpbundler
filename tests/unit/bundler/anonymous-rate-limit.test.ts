import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnonymousRateLimitMiddleware, RateLimitRule } from "../../../src/bundler/core/middleware/anonymous-rate-limit.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";
import { LoadingStrategy } from "../../../src/bundler/core/session/loading/loading-strategy.js";
import type { MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";

function makeCtx(sessionId = "s1"): MiddlewareContext {
  return {
    sessionId,
    bundleId: "anonymous",
    loadingStrategy: LoadingStrategy.PROGRESSIVE,
    notifyToolsChanged: vi.fn(),
    notifyResourcesChanged: vi.fn(),
    notifyPromptsChanged: vi.fn(),
    attachUpstream: vi.fn().mockResolvedValue(undefined),
    detachUpstream: vi.fn(),
    getAttachedNamespaces: vi.fn().mockReturnValue([]),
    getAvailableUpstreams: vi.fn().mockReturnValue([]),
  };
}

const TEST_RULE: RateLimitRule = {
  id: "test-rule",
  toolNames: ["governed__tool"],
  maxCalls: 3,
  windowMs: 60_000,
};

describe("AnonymousRateLimitMiddleware", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null (defers to the owning tool) for a tool name no rule governs", async () => {
    const mw = new AnonymousRateLimitMiddleware([TEST_RULE], new InMemorySessionStateStore());
    const result = await mw.handleOwnToolCall({ name: "ungoverned__tool", arguments: {} }, makeCtx());
    expect(result).toBeNull();
  });

  it("returns null for the first maxCalls governed calls within the window", async () => {
    const mw = new AnonymousRateLimitMiddleware([TEST_RULE], new InMemorySessionStateStore());
    const ctx = makeCtx();
    for (let i = 0; i < TEST_RULE.maxCalls; i++) {
      const result = await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, ctx);
      expect(result).toBeNull();
    }
  });

  it("rejects the call once maxCalls is exceeded within the window, with a structured error result", async () => {
    const mw = new AnonymousRateLimitMiddleware([TEST_RULE], new InMemorySessionStateStore());
    const ctx = makeCtx();
    for (let i = 0; i < TEST_RULE.maxCalls; i++) {
      await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, ctx);
    }

    const result = await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, ctx);

    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
    const text = (result!.content[0] as { text: string }).text;
    expect(text).toContain("Rate limit exceeded");
    expect(text).toContain("governed__tool");
    expect(text).toMatch(/try again in about \d+s/i);
  });

  it("tracks separate sessions independently", async () => {
    const mw = new AnonymousRateLimitMiddleware([TEST_RULE], new InMemorySessionStateStore());
    for (let i = 0; i < TEST_RULE.maxCalls; i++) {
      await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, makeCtx("s1"));
    }

    const otherSession = await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, makeCtx("s2"));
    expect(otherSession).toBeNull();
  });

  it("tracks separate rules independently even within the same session", async () => {
    const otherRule: RateLimitRule = { id: "other-rule", toolNames: ["other__tool"], maxCalls: 1, windowMs: 60_000 };
    const mw = new AnonymousRateLimitMiddleware([TEST_RULE, otherRule], new InMemorySessionStateStore());
    const ctx = makeCtx();
    for (let i = 0; i < TEST_RULE.maxCalls; i++) {
      await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, ctx);
    }

    const result = await mw.handleOwnToolCall({ name: "other__tool", arguments: {} }, ctx);
    expect(result).toBeNull();
  });

  it("allows calls again once the window has fully elapsed", async () => {
    const mw = new AnonymousRateLimitMiddleware([TEST_RULE], new InMemorySessionStateStore());
    const ctx = makeCtx();
    for (let i = 0; i < TEST_RULE.maxCalls; i++) {
      await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, ctx);
    }
    const limited = await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, ctx);
    expect(limited!.isError).toBe(true);

    vi.advanceTimersByTime(TEST_RULE.windowMs + 1);

    const afterWindow = await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, ctx);
    expect(afterWindow).toBeNull();
  });

  it("fails closed (denies the call) when the state store throws, rather than silently admitting it", async () => {
    const brokenStore = {
      get: vi.fn().mockRejectedValue(new Error("store unavailable")),
      set: vi.fn().mockRejectedValue(new Error("store unavailable")),
    };
    const mw = new AnonymousRateLimitMiddleware([TEST_RULE], brokenStore as any);

    const result = await mw.handleOwnToolCall({ name: "governed__tool", arguments: {} }, makeCtx());

    expect(result).not.toBeNull();
    expect(result!.isError).toBe(true);
  });
});
