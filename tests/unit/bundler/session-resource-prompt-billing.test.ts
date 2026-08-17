import { describe, it, expect, vi } from "vitest";
import { Session } from "../../../src/bundler/core/session/session.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";

// Session.create's parameter order (session.ts:376-390) is easy to
// misremember - read it directly rather than guessing, since a transposed
// argument here would silently construct a session with the wrong
// id/bundleId/accessToken instead of failing loudly.
function makeSessionWithMiddleware(onBeforeToolCall: ReturnType<typeof vi.fn>): Session {
    const session = Session.create(
        "sess-1", "bundle-1", "tok-real",
        {} as never, {} as never, {} as never, {} as never,
        new InMemorySessionStateStore(),
    );
    session.addMiddleware({
        name: "test-gate",
        onBeforeToolCall,
        onAfterToolCall: vi.fn(),
        onUpstreamAttached: vi.fn(),
    } as never);
    return session;
}

describe("Session.readResource", () => {
    it("is gated by onBeforeToolCall the same way callTool is", async () => {
        const deny = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "denied" }], isError: true,
        });
        const session = makeSessionWithMiddleware(deny);

        await expect(session.readResource({ uri: "some://resource" })).rejects.toThrow();
        expect(deny).toHaveBeenCalled();
    });
});

describe("Session.getPrompt", () => {
    it("is gated by onBeforeToolCall the same way callTool is", async () => {
        const deny = vi.fn().mockResolvedValue({
            content: [{ type: "text", text: "denied" }], isError: true,
        });
        const session = makeSessionWithMiddleware(deny);

        await expect(session.getPrompt({ name: "some-prompt", arguments: {} })).rejects.toThrow();
        expect(deny).toHaveBeenCalled();
    });
});
