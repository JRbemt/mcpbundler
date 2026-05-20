import { describe, it, expect, vi, beforeEach } from "vitest";
import { MiddlewareChain } from "../../../src/bundler/core/middleware/middleware-chain.js";
import { AbstractBundlerMiddleware, MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";
import type { Prompt, Resource, Tool, CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createTool } from "../../helpers/fixtures.js";

function makeResource(uri: string): Resource {
    return { uri, name: uri, mimeType: "text/plain" };
}

function makePrompt(name: string): Prompt {
    return { name };
}

function makeCtx(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
    return {
        sessionId: "test-session",
        bundleId: "test-bundle",
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

function makeParams(name = "some_tool"): CallToolRequest["params"] {
    return { name, arguments: {} };
}

function makeResult(text = "ok"): CallToolResult {
    return { content: [{ type: "text", text }] };
}

class SpyMiddleware extends AbstractBundlerMiddleware {
    constructor(readonly name: string) { super(); }
    transformSpy = vi.fn(async (tools: Tool[], ctx: MiddlewareContext) => tools);
    transformResourceSpy = vi.fn(async (resources: Resource[], ctx: MiddlewareContext) => resources);
    transformPromptSpy = vi.fn(async (prompts: Prompt[], ctx: MiddlewareContext) => prompts);
    handleSpy = vi.fn(async (p: CallToolRequest["params"], ctx: MiddlewareContext): Promise<CallToolResult | null> => null);
    beforeSpy = vi.fn(async (p: CallToolRequest["params"], ctx: MiddlewareContext) => { });
    afterSpy = vi.fn(async (p: CallToolRequest["params"], r: CallToolResult, ctx: MiddlewareContext) => r);
    attachSpy = vi.fn(async (ns: string, ctx: MiddlewareContext) => { });
    teardownSpy = vi.fn(async () => { });

    override async transformToolList(tools: Tool[], ctx: MiddlewareContext) { return this.transformSpy(tools, ctx); }
    override async transformResourceList(resources: Resource[], ctx: MiddlewareContext) { return this.transformResourceSpy(resources, ctx); }
    override async transformPromptList(prompts: Prompt[], ctx: MiddlewareContext) { return this.transformPromptSpy(prompts, ctx); }
    override async handleOwnToolCall(p: CallToolRequest["params"], ctx: MiddlewareContext) { return this.handleSpy(p, ctx); }
    override async onBeforeToolCall(p: CallToolRequest["params"], ctx: MiddlewareContext) { return this.beforeSpy(p, ctx); }
    override async onAfterToolCall(p: CallToolRequest["params"], r: CallToolResult, ctx: MiddlewareContext) { return this.afterSpy(p, r, ctx); }
    override async onUpstreamAttached(ns: string, ctx: MiddlewareContext) { return this.attachSpy(ns, ctx); }
    override async teardown() { return this.teardownSpy(); }
}

describe("MiddlewareChain", () => {
    let chain: MiddlewareChain;

    beforeEach(() => { chain = new MiddlewareChain(); });

    describe("lifecycle", () => {
        it("adds and finds middleware by name", () => {
            const mw = new SpyMiddleware("a");
            chain.add(mw);
            expect(chain.has("a")).toBe(true);
            expect(chain.getNames()).toEqual(["a"]);
        });

        it("throws on duplicate name", () => {
            chain.add(new SpyMiddleware("a"));
            expect(() => chain.add(new SpyMiddleware("a"))).toThrow(/already registered/);
        });

        it("removes existing middleware and returns true", () => {
            chain.add(new SpyMiddleware("a"));
            expect(chain.remove("a")).toBe(true);
            expect(chain.has("a")).toBe(false);
        });

        it("returns false when removing unknown middleware", () => {
            expect(chain.remove("missing")).toBe(false);
        });

        it("getNames reflects insertion order", () => {
            chain.add(new SpyMiddleware("first"));
            chain.add(new SpyMiddleware("second"));
            expect(chain.getNames()).toEqual(["first", "second"]);
        });
    });

    describe("transformToolList", () => {
        it("folds tools sequentially through each middleware", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.transformSpy.mockImplementation(async (tools: Tool[]) => [...tools, createTool({ name: "a_tool" })]);
            b.transformSpy.mockImplementation(async (tools: Tool[]) => [...tools, createTool({ name: "b_tool" })]);
            chain.add(a);
            chain.add(b);
            const result = await chain.transformToolList([createTool({ name: "base" })], ctx);
            expect(result.map((t) => t.name)).toEqual(["base", "a_tool", "b_tool"]);
        });

        it("continues with previous output when one middleware throws", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.transformSpy.mockRejectedValue(new Error("boom"));
            b.transformSpy.mockImplementation(async (tools: Tool[]) => [...tools, createTool({ name: "b_tool" })]);
            chain.add(a);
            chain.add(b);
            const tools = [createTool({ name: "base" })];
            const result = await chain.transformToolList(tools, ctx);
            expect(result.map((t) => t.name)).toEqual(["base", "b_tool"]);
        });
    });

    describe("handleOwnToolCall", () => {
        it("returns first non-null result", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.handleSpy.mockResolvedValue(null);
            b.handleSpy.mockResolvedValue(makeResult("b handled"));
            chain.add(a);
            chain.add(b);
            const result = await chain.handleOwnToolCall(makeParams(), ctx);
            expect((result!.content[0] as any).text).toBe("b handled");
            expect(b.handleSpy).toHaveBeenCalledOnce();
        });

        it("returns null when no middleware handles the call", async () => {
            chain.add(new SpyMiddleware("a"));
            const result = await chain.handleOwnToolCall(makeParams(), makeCtx());
            expect(result).toBeNull();
        });

        it("does not call subsequent middlewares after first match", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.handleSpy.mockResolvedValue(makeResult("a"));
            chain.add(a);
            chain.add(b);
            await chain.handleOwnToolCall(makeParams(), ctx);
            expect(b.handleSpy).not.toHaveBeenCalled();
        });
    });

    describe("onBeforeToolCall / onAfterToolCall", () => {
        it("calls all middlewares in order", async () => {
            const order: string[] = [];
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.beforeSpy.mockImplementation(async () => { order.push("a-before"); });
            b.beforeSpy.mockImplementation(async () => { order.push("b-before"); });
            chain.add(a);
            chain.add(b);
            await chain.onBeforeToolCall(makeParams(), ctx);
            expect(order).toEqual(["a-before", "b-before"]);
        });

        it("onAfterToolCall folds result through all middlewares", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.afterSpy.mockImplementation(async (_p, r) => ({ content: [{ type: "text" as const, text: "a-mutated" }] }));
            b.afterSpy.mockImplementation(async (_p, r: CallToolResult) => ({
                content: [{ type: "text" as const, text: (r.content[0] as any).text + "+b" }],
            }));
            chain.add(a);
            chain.add(b);
            const result = await chain.onAfterToolCall(makeParams(), makeResult("orig"), ctx);
            expect((result.content[0] as any).text).toBe("a-mutated+b");
        });

        it("skips and continues when onBefore throws", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.beforeSpy.mockRejectedValue(new Error("before-error"));
            chain.add(a);
            chain.add(b);
            await expect(chain.onBeforeToolCall(makeParams(), ctx)).resolves.not.toThrow();
            expect(b.beforeSpy).toHaveBeenCalled();
        });
    });

    describe("transformResourceList", () => {
        it("folds resources sequentially through each middleware", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.transformResourceSpy.mockImplementation(async (resources: Resource[]) => [...resources, makeResource("a://r")]);
            b.transformResourceSpy.mockImplementation(async (resources: Resource[]) => [...resources, makeResource("b://r")]);
            chain.add(a);
            chain.add(b);
            const result = await chain.transformResourceList([makeResource("base://r")], ctx);
            expect(result.map((r) => r.uri)).toEqual(["base://r", "a://r", "b://r"]);
        });

        it("continues with previous output when one middleware throws", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.transformResourceSpy.mockRejectedValue(new Error("boom"));
            b.transformResourceSpy.mockImplementation(async (resources: Resource[]) => [...resources, makeResource("b://r")]);
            chain.add(a);
            chain.add(b);
            const result = await chain.transformResourceList([makeResource("base://r")], ctx);
            expect(result.map((r) => r.uri)).toEqual(["base://r", "b://r"]);
        });
    });

    describe("transformPromptList", () => {
        it("folds prompts sequentially through each middleware", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.transformPromptSpy.mockImplementation(async (prompts: Prompt[]) => [...prompts, makePrompt("a-prompt")]);
            b.transformPromptSpy.mockImplementation(async (prompts: Prompt[]) => [...prompts, makePrompt("b-prompt")]);
            chain.add(a);
            chain.add(b);
            const result = await chain.transformPromptList([makePrompt("base")], ctx);
            expect(result.map((p) => p.name)).toEqual(["base", "a-prompt", "b-prompt"]);
        });
    });

    describe("onUpstreamAttached", () => {
        it("calls all middlewares with namespace", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            chain.add(a);
            chain.add(b);
            await chain.onUpstreamAttached("github", ctx);
            expect(a.attachSpy).toHaveBeenCalledWith("github", ctx);
            expect(b.attachSpy).toHaveBeenCalledWith("github", ctx);
        });
    });

    describe("teardown", () => {
        it("calls teardown on all middlewares even if one throws", async () => {
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.teardownSpy.mockRejectedValue(new Error("teardown-fail"));
            chain.add(a);
            chain.add(b);
            await expect(chain.teardown()).resolves.not.toThrow();
            expect(b.teardownSpy).toHaveBeenCalled();
        });
    });

    describe("error resilience - uncovered hooks", () => {
        it("handleOwnToolCall continues past throwing middleware and returns null", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.handleSpy.mockRejectedValue(new Error("handle-boom"));
            chain.add(a);
            chain.add(b);
            const result = await chain.handleOwnToolCall(makeParams(), ctx);
            expect(result).toBeNull();
            expect(b.handleSpy).toHaveBeenCalled();
        });

        it("onAfterToolCall continues past throwing middleware preserving last good result", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.afterSpy.mockRejectedValue(new Error("after-boom"));
            const initial = makeResult("orig");
            chain.add(a);
            chain.add(b);
            const result = await chain.onAfterToolCall(makeParams(), initial, ctx);
            expect(result).toEqual(initial);
            expect(b.afterSpy).toHaveBeenCalled();
        });

        it("onUpstreamAttached continues past throwing middleware", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.attachSpy.mockRejectedValue(new Error("attach-boom"));
            chain.add(a);
            chain.add(b);
            await chain.onUpstreamAttached("github", ctx);
            expect(b.attachSpy).toHaveBeenCalledWith("github", ctx);
        });

        it("transformPromptList continues past throwing middleware", async () => {
            const ctx = makeCtx();
            const a = new SpyMiddleware("a");
            const b = new SpyMiddleware("b");
            a.transformPromptSpy.mockRejectedValue(new Error("prompt-boom"));
            b.transformPromptSpy.mockImplementation(async (prompts) => [...prompts, makePrompt("b-added")]);
            chain.add(a);
            chain.add(b);
            const result = await chain.transformPromptList([makePrompt("base")], ctx);
            expect(result.map((p) => p.name)).toEqual(["base", "b-added"]);
        });
    });
});
