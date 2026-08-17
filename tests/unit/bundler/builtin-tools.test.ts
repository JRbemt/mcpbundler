import { describe, it, expect, vi, beforeEach } from "vitest";
import { BundlerSystemToolsMiddleware } from "../../../src/bundler/core/middleware/builtin-tools.js";
import type { MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";
import type { CallToolRequest, CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { createTool } from "../../helpers/fixtures.js";

function makeCtx(): MiddlewareContext {
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
    };
}

function makeSystemTool(name: string, handler?: CallToolRequest["params"] extends infer P ? (p: any, c: MiddlewareContext) => Promise<CallToolResult> : never) {
    return {
        tool: createTool({ name, description: `System tool ${name}` }),
        handler: handler ?? vi.fn().mockResolvedValue({ content: [{ type: "text" as const, text: `${name} result` }] }),
    };
}

describe("BundlerSystemToolsMiddleware", () => {
    let mw: BundlerSystemToolsMiddleware;

    beforeEach(() => { mw = new BundlerSystemToolsMiddleware(); });

    describe("registerTool", () => {
        it("adds the tool and makes it appear at the front of tools/list", async () => {
            const ctx = makeCtx();
            mw.registerTool(makeSystemTool("bundler__ping"));
            const upstreamTools = [createTool({ name: "github__search" })];
            const result = await mw.transformToolList(upstreamTools, ctx);
            expect(result[0].name).toBe("bundler__ping");
            expect(result[1].name).toBe("github__search");
        });

        it("throws on duplicate name", () => {
            mw.registerTool(makeSystemTool("bundler__ping"));
            expect(() => mw.registerTool(makeSystemTool("bundler__ping"))).toThrow(/already registered/);
        });

        it("registers multiple tools and lists them all", () => {
            mw.registerTool(makeSystemTool("bundler__a"));
            mw.registerTool(makeSystemTool("bundler__b"));
            expect(mw.getRegisteredToolNames()).toEqual(["bundler__a", "bundler__b"]);
        });
    });

    describe("unregisterTool", () => {
        it("removes a registered tool and returns true", async () => {
            mw.registerTool(makeSystemTool("bundler__ping"));
            expect(mw.unregisterTool("bundler__ping")).toBe(true);
            const result = await mw.transformToolList([], makeCtx());
            expect(result).toHaveLength(0);
        });

        it("returns false for unknown tool names", () => {
            expect(mw.unregisterTool("nonexistent")).toBe(false);
        });
    });

    describe("handleOwnToolCall", () => {
        it("dispatches to the registered handler", async () => {
            const handler = vi.fn().mockResolvedValue({ content: [{ type: "text" as const, text: "pong" }] });
            mw.registerTool({ tool: createTool({ name: "bundler__ping" }), handler });
            const result = await mw.handleOwnToolCall({ name: "bundler__ping", arguments: {} }, makeCtx());
            expect((result!.content[0] as any).text).toBe("pong");
            expect(handler).toHaveBeenCalledOnce();
        });

        it("returns null for unknown tool names", async () => {
            const result = await mw.handleOwnToolCall({ name: "unknown_tool", arguments: {} }, makeCtx());
            expect(result).toBeNull();
        });

        it("wraps handler exceptions as isError results", async () => {
            mw.registerTool({
                tool: createTool({ name: "bundler__broken" }),
                handler: async () => { throw new Error("handler blew up"); },
            });
            const result = await mw.handleOwnToolCall({ name: "bundler__broken", arguments: {} }, makeCtx());
            expect(result!.isError).toBe(true);
            expect((result!.content[0] as any).text).toContain("handler blew up");
        });
    });

    describe("transformToolList with no registered tools", () => {
        it("returns the upstream tools unchanged", async () => {
            const tools = [createTool({ name: "github__search" })];
            const result = await mw.transformToolList(tools, makeCtx());
            expect(result).toEqual(tools);
        });
    });
});
