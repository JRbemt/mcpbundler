import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import { PROTECTED_MIDDLEWARE_NAMES } from "../../../src/bundler/routes/bundler-mcp-routes.js";

// Anonymous sessions only mint when a discovery backend is configured (see
// the getDiscoveryBackendUrl() branch in bundler-mcp-routes.ts), so it has
// to be set before each BundlerServer is constructed here.
const ORIGINAL_BACKEND_URL = process.env.BACKEND_URL;

beforeEach(() => {
    process.env.BACKEND_URL = "http://discovery-backend.example.com";
});

afterEach(() => {
    process.env.BACKEND_URL = ORIGINAL_BACKEND_URL;
});

// Every fresh BundlerServer rejects connections for a 1s startup grace
// period (bundler-mcp-routes.ts's startupGracePeriodMs). Backdating the
// recorded start time is faster and more deterministic in a per-test
// harness than sleeping out the window on every construction.
function newTestBundler(): BundlerServer {
    const bundler = new BundlerServer(
        // concurrency.max_concurrent is read on every POST /mcp to enforce
        // the session cap - omitting it throws before a session is created.
        { name: "test", version: "0", concurrency: { max_concurrent: 10 } } as never,
        { resolveBundle: vi.fn() } as never,
    );
    (bundler as unknown as { serverStartTime: number }).serverStartTime = 0;
    return bundler;
}

// Minimal end-to-end harness: create a real anonymous session over HTTP,
// then attempt to remove/install middleware on it. Exercises the actual
// route wiring, not a unit-level mock of removeMiddlewareFromSession -
// the finding is specifically about the route's own authorization, which
// a mocked call to the underlying method would not catch a regression in.
async function createAnonymousSession(app: import("express").Application): Promise<string> {
    const res = await request(app)
        .post("/mcp")
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .send({
            jsonrpc: "2.0", id: 1, method: "initialize",
            params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
        });
    const sessionId = res.headers["mcp-session-id"] as string;
    expect(sessionId).toBeTruthy();
    return sessionId;
}

describe("PROTECTED_MIDDLEWARE_NAMES", () => {
    it("includes every security-relevant middleware name", () => {
        expect(PROTECTED_MIDDLEWARE_NAMES.has("token-spend-check")).toBe(true);
        expect(PROTECTED_MIDDLEWARE_NAMES.has("anonymous-rate-limit")).toBe(true);
    });
});

describe("DELETE /mcp/middleware/:name", () => {
    it("refuses to remove a protected middleware even from the owning session", async () => {
        const bundler = newTestBundler();
        const app = (bundler as unknown as { app: import("express").Application }).app;
        const sessionId = await createAnonymousSession(app);

        const res = await request(app)
            .delete("/mcp/middleware/anonymous-rate-limit")
            .set("Mcp-Session-Id", sessionId);

        expect(res.status).toBe(403);
        expect(res.body.error).toContain("protected");
    });

    it("still allows removing an unprotected middleware", async () => {
        const bundler = newTestBundler();
        const app = (bundler as unknown as { app: import("express").Application }).app;
        const sessionId = await createAnonymousSession(app);

        // llm-tool-router is not installed on the anonymous session by
        // default, so this proves the request reaches removeMiddlewareFromSession
        // (404 "not found on this session") rather than being blocked by
        // the new allowlist (which would be 403).
        const res = await request(app)
            .delete("/mcp/middleware/llm-tool-router")
            .set("Mcp-Session-Id", sessionId);

        expect(res.status).toBe(404);
    });
});

describe("POST /mcp/middleware", () => {
    it("refuses to install a middleware under a protected name", async () => {
        const bundler = newTestBundler();
        const app = (bundler as unknown as { app: import("express").Application }).app;
        const sessionId = await createAnonymousSession(app);

        const res = await request(app)
            .post("/mcp/middleware")
            .set("Mcp-Session-Id", sessionId)
            .send({ name: "token-spend-check" });

        expect(res.status).toBe(403);
    });
});
