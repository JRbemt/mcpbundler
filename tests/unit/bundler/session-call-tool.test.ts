import { describe, it, expect, vi } from "vitest";
import { Session, SessionState } from "../../../src/bundler/core/session/session.js";
import { AbstractBundlerMiddleware, MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";
import type { INamespaceService } from "../../../src/bundler/core/session/namespace-resolver.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

class RejectingMiddleware extends AbstractBundlerMiddleware {
    readonly name = "rejecting";
    async onBeforeToolCall(
        _params: CallToolRequest["params"],
        _ctx: MiddlewareContext,
    ): Promise<CallToolResult | void> {
        return { content: [{ type: "text", text: "rejected" }], isError: true };
    }
}

function makeSession(namespaceService: INamespaceService | null): Session {
    return new Session(
        "sess-1",
        "bundle-1",
        "tok-abc",
        new Date(),
        namespaceService,
        null,
        null,
        null,
        new Date(),
        SessionState.Active,
        new InMemorySessionStateStore(),
    );
}

describe("Session.callTool - onBeforeToolCall short-circuit", () => {
    it("returns the middleware's rejection result without routing to a namespace", async () => {
        const extractNamespaceFromName = vi.fn();
        const namespaceService: INamespaceService = {
            namespaceTool: vi.fn(),
            namespaceResource: vi.fn(),
            namespaceResourceTemplate: vi.fn(),
            namespacePrompt: vi.fn(),
            namespaceUri: vi.fn(),
            extractNamespaceFromName,
            extractNamespaceFromUri: vi.fn(),
        };
        const session = makeSession(namespaceService);
        session.addMiddleware(new RejectingMiddleware());

        const result = await session.callTool({ name: "github__search", arguments: {} });

        expect(result.isError).toBe(true);
        expect((result.content[0] as { text: string }).text).toBe("rejected");
        expect(extractNamespaceFromName).not.toHaveBeenCalled();
    });

    it("routes normally (falls through to the no-namespace-service guard) when no middleware rejects the call", async () => {
        const session = makeSession(null);

        const result = await session.callTool({ name: "github__search", arguments: {} });

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([]);
    });

    it("exposes accessToken on the MiddlewareContext passed to middleware", async () => {
        let observedToken: string | undefined;
        class CapturingMiddleware extends AbstractBundlerMiddleware {
            readonly name = "capturing";
            async onBeforeToolCall(_params: CallToolRequest["params"], ctx: MiddlewareContext): Promise<CallToolResult | void> {
                observedToken = ctx.accessToken;
            }
        }
        const session = makeSession(null);
        session.addMiddleware(new CapturingMiddleware());

        await session.callTool({ name: "github__search", arguments: {} });

        expect(observedToken).toBe("tok-abc");
    });
});
