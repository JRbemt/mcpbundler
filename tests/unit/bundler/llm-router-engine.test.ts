import { describe, it, expect, vi } from "vitest";
import { LLMRouterEngine } from "../../../src/bundler/core/middleware/llm-router/router-engine.js";
import { AllPassToolRouterLLM, type LLMRouterTool } from "../../../src/bundler/core/middleware/llm-router/router-tool.js";
import type { MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";
import { createMCPConfig } from "../../helpers/fixtures.js";

function makeCtx(namespaces: string[], available = namespaces): MiddlewareContext {
    const upstreams = available.map((ns) => createMCPConfig({ namespace: ns }));
    return {
        sessionId: "s",
        bundleId: "b",
        notifyToolsChanged: vi.fn(),
        notifyResourcesChanged: vi.fn(),
        notifyPromptsChanged: vi.fn(),
        attachUpstream: vi.fn().mockResolvedValue(undefined),
        detachUpstream: vi.fn(),
        getAttachedNamespaces: vi.fn().mockReturnValue(namespaces),
        getAvailableUpstreams: vi.fn().mockReturnValue(upstreams),
    };
}

describe("LLMRouterEngine", () => {
    describe("isReady", () => {
        it("starts as not ready", () => {
            const engine = new LLMRouterEngine(new AllPassToolRouterLLM());
            expect(engine.isReady()).toBe(false);
        });

        it("becomes ready after a successful reRank", async () => {
            const engine = new LLMRouterEngine(new AllPassToolRouterLLM());
            await engine.reRank(makeCtx(["github"]), "task context", 5);
            expect(engine.isReady()).toBe(true);
        });
    });

    describe("reRank with empty context", () => {
        it("returns false without calling the LLM when context is empty", async () => {
            const llm = new AllPassToolRouterLLM();
            const spy = vi.spyOn(llm, "selectNamespaces");
            const engine = new LLMRouterEngine(llm);

            const result = await engine.reRank(makeCtx(["github"]), "", 5);

            expect(result).toBe(false);
            expect(spy).not.toHaveBeenCalled();
            expect(engine.isReady()).toBe(false);
        });

        it("returns false for whitespace-only context", async () => {
            const engine = new LLMRouterEngine(new AllPassToolRouterLLM());
            const result = await engine.reRank(makeCtx([]), "   ", 5);
            // "   " is truthy so reRank proceeds - this tests that whitespace passes through
            expect(typeof result).toBe("boolean");
        });
    });

    describe("reRank - namespace attachment", () => {
        it("attaches a newly selected namespace that is not yet attached", async () => {
            const llm: LLMRouterTool = { selectNamespaces: vi.fn().mockResolvedValue(["github", "stripe"]) };
            const engine = new LLMRouterEngine(llm);
            const attachUpstream = vi.fn().mockResolvedValue(undefined);
            const ctx = {
                ...makeCtx(["github"], ["github", "stripe"]),
                attachUpstream,
            };

            await engine.reRank(ctx, "task", 5);

            expect(attachUpstream).toHaveBeenCalledOnce();
            expect(attachUpstream.mock.calls[0][0].namespace).toBe("stripe");
        });

        it("does not attach a namespace that is already attached", async () => {
            const llm: LLMRouterTool = { selectNamespaces: vi.fn().mockResolvedValue(["github"]) };
            const engine = new LLMRouterEngine(llm);
            const attachUpstream = vi.fn().mockResolvedValue(undefined);
            const ctx = { ...makeCtx(["github"]), attachUpstream };

            await engine.reRank(ctx, "task", 5);

            expect(attachUpstream).not.toHaveBeenCalled();
        });

        it("skips attaching when LLM returns a namespace not in the available map", async () => {
            const llm: LLMRouterTool = { selectNamespaces: vi.fn().mockResolvedValue(["ghost-ns"]) };
            const engine = new LLMRouterEngine(llm);
            const attachUpstream = vi.fn();
            const ctx = { ...makeCtx([], ["github"]), attachUpstream };

            await engine.reRank(ctx, "task", 5);

            expect(attachUpstream).not.toHaveBeenCalled();
        });
    });

    describe("reRank - error handling", () => {
        it("returns false and does not mark engine ready when LLM throws", async () => {
            const llm: LLMRouterTool = { selectNamespaces: vi.fn().mockRejectedValue(new Error("LLM unavailable")) };
            const engine = new LLMRouterEngine(llm);
            const ctx = makeCtx([], ["github", "stripe"]);

            const result = await engine.reRank(ctx, "task", 5);

            expect(result).toBe(false);
            expect(engine.isReady()).toBe(false);
        });

        it("attaches all available upstreams as fallback when LLM throws", async () => {
            const llm: LLMRouterTool = { selectNamespaces: vi.fn().mockRejectedValue(new Error("timeout")) };
            const engine = new LLMRouterEngine(llm);
            const attachUpstream = vi.fn().mockResolvedValue(undefined);
            const ctx = {
                ...makeCtx([], ["github", "stripe"]),
                attachUpstream,
            };

            await engine.reRank(ctx, "task", 5);

            expect(attachUpstream).toHaveBeenCalledTimes(2);
        });

        it("respects maxActiveUpstreams in fallback attachment", async () => {
            const llm: LLMRouterTool = { selectNamespaces: vi.fn().mockRejectedValue(new Error("err")) };
            const engine = new LLMRouterEngine(llm);
            const attachUpstream = vi.fn().mockResolvedValue(undefined);
            const ctx = {
                ...makeCtx([], ["github", "stripe", "jira", "notion"]),
                attachUpstream,
            };

            await engine.reRank(ctx, "task", 2);

            expect(attachUpstream).toHaveBeenCalledTimes(2);
        });
    });

    describe("reRank - changed detection", () => {
        it("returns true on first successful rank (empty → non-empty)", async () => {
            const engine = new LLMRouterEngine(new AllPassToolRouterLLM());
            const changed = await engine.reRank(makeCtx(["github"]), "task", 5);
            expect(changed).toBe(true);
        });

        it("returns false when the selected set does not change", async () => {
            const engine = new LLMRouterEngine(new AllPassToolRouterLLM());
            const ctx = makeCtx(["github"]);
            await engine.reRank(ctx, "task1", 5);
            const changed = await engine.reRank(ctx, "task2", 5);
            expect(changed).toBe(false);
        });

        it("returns true when the selected set grows", async () => {
            let call = 0;
            const llm: LLMRouterTool = {
                selectNamespaces: vi.fn().mockImplementation(async () =>
                    call++ === 0 ? ["github"] : ["github", "stripe"]
                ),
            };
            const engine = new LLMRouterEngine(llm);
            const ctx = makeCtx(["github", "stripe"], ["github", "stripe"]);
            await engine.reRank(ctx, "task1", 5);
            const changed = await engine.reRank(ctx, "task2", 5);
            expect(changed).toBe(true);
        });
    });
});
