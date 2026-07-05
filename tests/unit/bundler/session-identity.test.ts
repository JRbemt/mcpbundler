import { describe, it, expect } from "vitest";
import { TransportHeaderSessionIdentity } from "../../../src/bundler/core/session/session-identity.js";
import type { Request } from "express";

function makeReq(overrides: Partial<{ headers: Record<string, string>; query: Record<string, unknown> }> = {}): Request {
    return {
        headers: overrides.headers ?? {},
        query: overrides.query ?? {},
    } as unknown as Request;
}

describe("TransportHeaderSessionIdentity", () => {
    describe("resolve", () => {
        it("reads the Mcp-Session-Id header", () => {
            const identity = new TransportHeaderSessionIdentity();
            const req = makeReq({ headers: { "mcp-session-id": "abc-123" } });
            expect(identity.resolve(req)).toBe("abc-123");
        });

        it("falls back to the sessionId query param when no header is present", () => {
            const identity = new TransportHeaderSessionIdentity();
            const req = makeReq({ query: { sessionId: "query-456" } });
            expect(identity.resolve(req)).toBe("query-456");
        });

        it("prefers the header over the query param when both are present", () => {
            const identity = new TransportHeaderSessionIdentity();
            const req = makeReq({ headers: { "mcp-session-id": "header-1" }, query: { sessionId: "query-1" } });
            expect(identity.resolve(req)).toBe("header-1");
        });

        it("returns undefined when neither is present", () => {
            const identity = new TransportHeaderSessionIdentity();
            expect(identity.resolve(makeReq())).toBeUndefined();
        });
    });

    describe("issue", () => {
        it("generates unique ids", () => {
            const identity = new TransportHeaderSessionIdentity();
            const a = identity.issue();
            const b = identity.issue();
            expect(a).not.toBe(b);
            expect(typeof a).toBe("string");
            expect(a.length).toBeGreaterThan(0);
        });
    });
});
