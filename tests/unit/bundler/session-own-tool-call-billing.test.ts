import { describe, it, expect, vi } from "vitest";
import { Session } from "../../../src/bundler/core/session/session.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";

describe("Session.callTool", () => {
    it("still runs onBeforeToolCall's spend check for a middleware-owned tool call", async () => {
        const session = Session.create(
            "sess-1", "bundle-1", "tok-real",
            {} as never, {} as never, {} as never, {} as never,
            new InMemorySessionStateStore(),
        );
        const spendCheck = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "insufficient balance" }], isError: true,
            structuredContent: { reason: "insufficient_balance", balance: 0 },
        });
        session.addMiddleware({
            name: "spend-check", onBeforeToolCall: spendCheck,
            onAfterToolCall: vi.fn(), onUpstreamAttached: vi.fn(),
        } as never);
        // handleOwnToolCall would normally short-circuit before onBeforeToolCall
        // is ever reached for a name this middleware claims - simulate that by
        // adding a second middleware whose handleOwnToolCall claims the name,
        // matching how LLMToolRouterMiddleware claims bundler__set_context.
        session.addMiddleware({
            name: "own-tool-owner", onBeforeToolCall: vi.fn(),
            handleOwnToolCall: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
            onAfterToolCall: vi.fn(), onUpstreamAttached: vi.fn(),
        } as never);

        const result = await session.callTool({ name: "bundler__set_context", arguments: {} });

        expect(spendCheck).toHaveBeenCalled();
        expect(result.isError).toBe(true);
    });
});
