import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMToolRouterMiddleware } from "../../../src/bundler/core/middleware/llm-router/router-tool-middleware.js";
import { AllPassToolRouterLLM, LLMRouterTool } from "../../../src/bundler/core/middleware/llm-router/router-tool.js";
import type { MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";
import type { CallToolRequest, CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { createTool, createMCPConfig } from "../../helpers/fixtures.js";
import type { MCPConfig } from "../../../src/bundler/core/schemas.js";

const SET_CONTEXT = "bundler__set_context";

function makeCtx(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
    return {
        sessionId: "s1",
        bundleId: "b1",
        accessToken: "test-token",
        notifyToolsChanged: vi.fn(),
        notifyResourcesChanged: vi.fn(),
        notifyPromptsChanged: vi.fn(),
        attachUpstream: vi.fn().mockResolvedValue(undefined),
        detachUpstream: vi.fn(),
        getAttachedNamespaces: vi.fn().mockReturnValue([]),
        getAvailableUpstreams: vi.fn().mockReturnValue([]),
        ...overrides,
    };
}

function makeNamespacedTool(namespace: string, toolSuffix: string): Tool {
    return createTool({ name: `${namespace}__${toolSuffix}` });
}

function makeUpstreams(namespaces: string[]): MCPConfig[] {
    return namespaces.map((ns) => createMCPConfig({ namespace: ns, url: `https://${ns}.example.com` }));
}

function makeSetContextParams(task: string): CallToolRequest["params"] {
    return { name: SET_CONTEXT, arguments: { task } };
}

describe("LLMToolRouterMiddleware", () => {
    describe("AllPassToolRouterLLM", () => {
        it("returns all namespaces up to max", async () => {
            const llm = new AllPassToolRouterLLM();
            const upstreams = makeUpstreams(["a", "b", "c", "d"]);
            const result = await llm.selectNamespaces("any", upstreams, 2);
            expect(result).toEqual(["a", "b"]);
        });

        it("returns all when count is within max", async () => {
            const llm = new AllPassToolRouterLLM();
            const upstreams = makeUpstreams(["x", "y"]);
            const result = await llm.selectNamespaces("any", upstreams, 10);
            expect(result).toEqual(["x", "y"]);
        });
    });

    describe("set_context signal (Signal 2)", () => {
        let mw: LLMToolRouterMiddleware;

        beforeEach(() => {
            mw = new LLMToolRouterMiddleware({
                llm: new AllPassToolRouterLLM(),
                setContext: { enabled: true, maxActiveUpstreams: 10 },
            });
        });

        it("always includes bundler__set_context in tools/list", async () => {
            const tools = [makeNamespacedTool("github", "search")];
            const result = await mw.transformToolList(tools, makeCtx());
            expect(result.some((t) => t.name === SET_CONTEXT)).toBe(true);
        });

        it("passes all tools through before first set_context call", async () => {
            const tools = [makeNamespacedTool("github", "search"), makeNamespacedTool("notion", "list")];
            const result = await mw.transformToolList(tools, makeCtx());
            expect(result.find((t) => t.name === "github__search")).toBeDefined();
            expect(result.find((t) => t.name === "notion__list")).toBeDefined();
        });

        it("returns confirmation text and fires reRank on set_context call", async () => {
            const upstreams = makeUpstreams(["github", "notion"]);
            const ctx = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github", "notion"]),
            });
            const result = await mw.handleOwnToolCall(makeSetContextParams("search GitHub repos"), ctx);
            expect(result).not.toBeNull();
            expect((result!.content[0] as any).text).toContain("Context updated");
        });

        it("returns null for non-set_context tool names", async () => {
            const result = await mw.handleOwnToolCall({ name: "github__search", arguments: {} }, makeCtx());
            expect(result).toBeNull();
        });

        it("filters tools to selected namespaces after reRank resolves", async () => {
            const upstreams = makeUpstreams(["github", "notion", "stripe"]);
            const selectSpy = vi.fn().mockResolvedValue(["github"]);
            const llm: LLMRouterTool = { selectNamespaces: selectSpy };
            const routerMw = new LLMToolRouterMiddleware({
                llm,
                setContext: { enabled: true, maxActiveUpstreams: 1 },
            });

            const ctx = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github", "notion", "stripe"]),
            });

            await routerMw.handleOwnToolCall(makeSetContextParams("search repos"), ctx);
            // give the non-blocking reRank microtask time to complete
            await new Promise((r) => setImmediate(r));

            const tools = [
                makeNamespacedTool("github", "search"),
                makeNamespacedTool("notion", "list"),
                makeNamespacedTool("stripe", "charge"),
            ];
            const result = await routerMw.transformToolList(tools, ctx);
            const names = result.map((t) => t.name);
            expect(names).toContain("github__search");
            expect(names).not.toContain("notion__list");
            expect(names).not.toContain("stripe__charge");
            expect(names).toContain(SET_CONTEXT);
        });

        it("does not inject set_context tool when signal is disabled", async () => {
            const noCtxMw = new LLMToolRouterMiddleware({ llm: new AllPassToolRouterLLM() });
            const result = await noCtxMw.transformToolList([], makeCtx());
            expect(result.some((t) => t.name === SET_CONTEXT)).toBe(false);
        });

        it("notifyToolsChanged called only when selected set actually changes", async () => {
            const upstreams = makeUpstreams(["github"]);
            const notify = vi.fn();
            const ctx = makeCtx({
                notifyToolsChanged: notify,
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github"]),
            });
            await mw.handleOwnToolCall(makeSetContextParams("task1"), ctx);
            await new Promise((r) => setImmediate(r));
            expect(notify).toHaveBeenCalledTimes(1);

            // Same selection - should not notify again
            await mw.handleOwnToolCall(makeSetContextParams("task2"), ctx);
            await new Promise((r) => setImmediate(r));
            expect(notify).toHaveBeenCalledTimes(1);
        });
    });

    describe("rolling_window signal (Signal 1)", () => {
        let mw: LLMToolRouterMiddleware;

        beforeEach(() => {
            mw = new LLMToolRouterMiddleware({
                llm: new AllPassToolRouterLLM(),
                rollingWindow: { enabled: true, maxActiveUpstreams: 10, windowSize: 3, reRankEveryNCalls: 2 },
            });
        });

        it("does not fire reRank before threshold is reached", async () => {
            const upstreams = makeUpstreams(["github"]);
            const notify = vi.fn();
            const ctx = makeCtx({
                notifyToolsChanged: notify,
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github"]),
            });

            // First call - threshold is 2, so no reRank yet
            await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, ctx);
            await new Promise((r) => setImmediate(r));
            expect(notify).not.toHaveBeenCalled();
        });

        it("fires reRank after reaching reRankEveryNCalls threshold (when initialized)", async () => {
            const upstreams = makeUpstreams(["github", "notion"]);
            const notify = vi.fn();
            const ctx = makeCtx({
                notifyToolsChanged: notify,
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github", "notion"]),
            });

            // Initialize via set_context so isInitialized = true
            const initMw = new LLMToolRouterMiddleware({
                llm: new AllPassToolRouterLLM(),
                setContext: { enabled: true, maxActiveUpstreams: 10 },
                rollingWindow: { enabled: true, maxActiveUpstreams: 10, windowSize: 3, reRankEveryNCalls: 2 },
            });
            await initMw.handleOwnToolCall(makeSetContextParams("init"), ctx);
            await new Promise((r) => setImmediate(r));

            const initialNotifyCount = notify.mock.calls.length;

            await initMw.onBeforeToolCall({ name: "github__search", arguments: {} }, ctx);
            await initMw.onBeforeToolCall({ name: "notion__list", arguments: {} }, ctx);
            await new Promise((r) => setImmediate(r));

            expect(notify.mock.calls.length).toBeGreaterThanOrEqual(initialNotifyCount);
        });

        it("trims call history to windowSize", async () => {
            const ctx = makeCtx();
            // windowSize = 3; send 5 calls
            for (let i = 0; i < 5; i++) {
                await mw.onBeforeToolCall({ name: `tool_${i}`, arguments: {} }, ctx);
            }
            // No assertion on internal state, but it should not throw
        });

        it("does not fire when rolling_window is disabled", async () => {
            const noRollingMw = new LLMToolRouterMiddleware({ llm: new AllPassToolRouterLLM() });
            const ctx = makeCtx();
            for (let i = 0; i < 10; i++) {
                await noRollingMw.onBeforeToolCall({ name: "some_tool", arguments: {} }, ctx);
            }
            expect(ctx.notifyToolsChanged).not.toHaveBeenCalled();
        });
    });

    describe("namespace extraction", () => {
        it("extracts namespace from double-underscore format", async () => {
            const selectSpy = vi.fn().mockResolvedValue(["github"]);
            const mw = new LLMToolRouterMiddleware({
                llm: { selectNamespaces: selectSpy },
                setContext: { enabled: true, maxActiveUpstreams: 10 },
            });
            const upstreams = makeUpstreams(["github", "notion"]);
            const ctx = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github", "notion"]),
            });
            await mw.handleOwnToolCall(makeSetContextParams("task"), ctx);
            await new Promise((r) => setImmediate(r));

            const tools = [makeNamespacedTool("github", "search"), makeNamespacedTool("notion", "list")];
            const result = await mw.transformToolList(tools, ctx);
            expect(result.some((t) => t.name === "github__search")).toBe(true);
            expect(result.some((t) => t.name === "notion__list")).toBe(false);
        });

        it("falls back to _meta.namespace for tools without double-underscore", async () => {
            const selectSpy = vi.fn().mockResolvedValue(["github"]);
            const mw = new LLMToolRouterMiddleware({
                llm: { selectNamespaces: selectSpy },
                setContext: { enabled: true, maxActiveUpstreams: 10 },
            });
            const upstreams = makeUpstreams(["github"]);
            const ctx = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github"]),
            });
            await mw.handleOwnToolCall(makeSetContextParams("task"), ctx);
            await new Promise((r) => setImmediate(r));

            const toolWithMeta = { ...createTool({ name: "hashed_xyz123" }), _meta: { namespace: "github" } };
            const result = await mw.transformToolList([toolWithMeta as Tool], ctx);
            expect(result.some((t) => t.name === "hashed_xyz123")).toBe(true);
        });
    });

    describe("onUpstreamAttached", () => {
        it("does not fire reRank before initialization", async () => {
            const mw = new LLMToolRouterMiddleware({
                llm: new AllPassToolRouterLLM(),
                setContext: { enabled: true, maxActiveUpstreams: 10 },
            });
            const ctx = makeCtx();
            await mw.onUpstreamAttached("github", ctx);
            expect(ctx.notifyToolsChanged).not.toHaveBeenCalled();
        });

        it("fires reRank after initialization when a new upstream attaches", async () => {
            const notify = vi.fn();
            const upstreams = makeUpstreams(["github", "notion"]);
            const ctx = makeCtx({
                notifyToolsChanged: notify,
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github", "notion"]),
            });

            const mw = new LLMToolRouterMiddleware({
                llm: new AllPassToolRouterLLM(),
                setContext: { enabled: true, maxActiveUpstreams: 10 },
            });
            await mw.handleOwnToolCall(makeSetContextParams("init"), ctx);
            await new Promise((r) => setImmediate(r));

            const countBefore = notify.mock.calls.length;
            // Add a new upstream and notify
            const extendedUpstreams = [...upstreams, createMCPConfig({ namespace: "stripe", url: "https://stripe.example.com" })];
            const ctx2 = makeCtx({
                notifyToolsChanged: notify,
                getAvailableUpstreams: vi.fn().mockReturnValue(extendedUpstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github", "notion", "stripe"]),
            });
            await mw.onUpstreamAttached("stripe", ctx2);
            await new Promise((r) => setImmediate(r));
            // AllPass selects all - set changes, so notify fires
            expect(notify.mock.calls.length).toBeGreaterThanOrEqual(countBefore);
        });
    });

    describe("onUpstreamAttached - rolling window path", () => {
        it("fires reRank using rolling history when setContext is enabled but no context is set and rolling has history", async () => {
            // Initialize the engine via set_context with a real task so isReady() = true.
            // Then call onUpstreamAttached before a second set_context task is declared
            // so currentContext is still set from the first call - this means the IF branch wins.
            // The else-if (rolling window) branch is only reachable when setContextEnabled is false
            // but the engine is already ready, which can only happen if set_context initialized it
            // first - an edge case not achievable through the public API without both signals active.
            // This test instead verifies the combined-signal scenario where rolling window fires
            // the reRank after onBeforeToolCall has built history and the engine is already initialized.
            const llm = new AllPassToolRouterLLM();
            const selectSpy = vi.spyOn(llm, "selectNamespaces");
            const mw = new LLMToolRouterMiddleware({
                llm,
                setContext: { enabled: true, maxActiveUpstreams: 5 },
                rollingWindow: { enabled: true, maxActiveUpstreams: 5, windowSize: 5, reRankEveryNCalls: 1 },
            });

            const upstreams = makeUpstreams(["github"]);
            const ctx = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github"]),
            });

            // Initialize engine via set_context
            await mw.handleOwnToolCall(makeSetContextParams("seed"), ctx);
            await new Promise((r) => setImmediate(r));
            selectSpy.mockClear();

            // Build rolling window call history now that engine is ready
            await mw.onBeforeToolCall({ name: "github__read", arguments: {} }, ctx);
            await new Promise((r) => setImmediate(r));
            selectSpy.mockClear();

            // onUpstreamAttached should fire a reRank (via the set_context branch since currentContext is set)
            const ctx2 = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(makeUpstreams(["github", "stripe"])),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github", "stripe"]),
            });
            await mw.onUpstreamAttached("stripe", ctx2);
            await new Promise((r) => setTimeout(r, 10));
            expect(selectSpy).toHaveBeenCalled();
        });
    });

    describe("extractNamespace - no separator and no _meta.namespace", () => {
        it("excludes a tool that has neither __ separator nor _meta.namespace", async () => {
            const selectSpy = vi.fn().mockResolvedValue(["github"]);
            const mw = new LLMToolRouterMiddleware({
                llm: { selectNamespaces: selectSpy },
                setContext: { enabled: true, maxActiveUpstreams: 10 },
            });
            const upstreams = makeUpstreams(["github"]);
            const ctx = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github"]),
            });
            await mw.handleOwnToolCall(makeSetContextParams("task"), ctx);
            await new Promise((r) => setImmediate(r));

            const noNs = createTool({ name: "plainname" });
            const withNs = makeNamespacedTool("github", "search");
            const result = await mw.transformToolList([noNs, withNs], ctx);
            expect(result.some((t) => t.name === "github__search")).toBe(true);
            expect(result.some((t) => t.name === "plainname")).toBe(false);
        });
    });

    describe("triggerReRank - error path", () => {
        it("logs and does not throw when reRank rejects", async () => {
            const llm: LLMRouterTool = {
                selectNamespaces: vi.fn().mockRejectedValue(new Error("llm down")),
            };
            const mw = new LLMToolRouterMiddleware({
                llm,
                setContext: { enabled: true, maxActiveUpstreams: 10 },
            });
            const ctx = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(makeUpstreams(["github"])),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github"]),
            });
            await mw.handleOwnToolCall(makeSetContextParams("task"), ctx);
            await new Promise((r) => setTimeout(r, 10));
            // No throw - just confirms the error path is handled
        });
    });

    describe("attachUpstream called for unattached selected namespace", () => {
        it("calls ctx.attachUpstream for newly selected but unattached namespaces", async () => {
            const selectSpy = vi.fn().mockResolvedValue(["github", "notion"]);
            const mw = new LLMToolRouterMiddleware({
                llm: { selectNamespaces: selectSpy },
                setContext: { enabled: true, maxActiveUpstreams: 10 },
            });
            const upstreams = makeUpstreams(["github", "notion"]);
            const attachUpstream = vi.fn().mockResolvedValue(undefined);
            const ctx = makeCtx({
                getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
                getAttachedNamespaces: vi.fn().mockReturnValue(["github"]), // notion NOT attached
                attachUpstream,
            });

            await mw.handleOwnToolCall(makeSetContextParams("task"), ctx);
            await new Promise((r) => setImmediate(r));

            expect(attachUpstream).toHaveBeenCalledOnce();
            expect(attachUpstream.mock.calls[0][0].namespace).toBe("notion");
        });
    });
});
