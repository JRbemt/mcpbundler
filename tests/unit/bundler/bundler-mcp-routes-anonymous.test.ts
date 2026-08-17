import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import { SESSION_EVENTS } from "../../../src/bundler/core/session/session.js";
import type { ResolverService } from "../../../src/bundler/core/resolver/service.js";
import type { BundlerConfig } from "../../../src/bundler/core/schemas.js";

// Route-level coverage for the anonymous /mcp initialize branch in
// bundler-mcp-routes.ts: this is the only place that (a) gates anonymous
// discovery on a configured backend and (b) wires the SHUTDOWN listener
// that reclaims an idle anonymous session. Neither is reachable by testing
// BundlerServer.createAnonymousSession directly, since that method has no
// opinion on whether the caller should have been allowed to reach it.

function makeConfig(): BundlerConfig {
  return {
    name: "test-bundler",
    version: "0.0.0",
    host: "0.0.0.0",
    port: 0,
    concurrency: { max_concurrent: 10 },
  } as unknown as BundlerConfig;
}

function makeResolver(): ResolverService {
  return { resolveBundle: vi.fn() } as unknown as ResolverService;
}

async function startServer(bundler: BundlerServer): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(bundler.getApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

function initializeRequestBody() {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    },
  };
}

async function postInitialize(baseUrl: string): Promise<Response> {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(initializeRequestBody()),
  });
}

describe("POST /mcp - anonymous discovery session", () => {
  let withBackend: { bundler: BundlerServer; server: http.Server; baseUrl: string };
  let withoutBackend: { bundler: BundlerServer; server: http.Server; baseUrl: string };
  const ORIGINAL_BACKEND_URL = process.env.BACKEND_URL;

  beforeAll(async () => {
    process.env.BACKEND_URL = "http://discovery-backend.example.com";
    const bundlerWith = new BundlerServer(makeConfig(), makeResolver());
    withBackend = { bundler: bundlerWith, ...(await startServer(bundlerWith)) };

    delete process.env.BACKEND_URL;
    const bundlerWithout = new BundlerServer(makeConfig(), makeResolver());
    withoutBackend = { bundler: bundlerWithout, ...(await startServer(bundlerWithout)) };

    process.env.BACKEND_URL = ORIGINAL_BACKEND_URL;

    // Both servers reject new sessions during their 1s startup grace period
    // (see bundler-mcp-routes.ts's startupGracePeriodMs) - wait it out once
    // rather than in every test.
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }, 15000);

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((resolve) => withBackend.server.close(() => resolve())),
      new Promise<void>((resolve) => withoutBackend.server.close(() => resolve())),
    ]);
    process.env.BACKEND_URL = ORIGINAL_BACKEND_URL;
  });

  it("creates an anonymous session and returns a session id when a discovery backend is configured", async () => {
    const response = await postInitialize(withBackend.baseUrl);

    expect(response.status).toBe(200);
    const sessionId = response.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    expect(withBackend.bundler.getSession(sessionId!)).toBeDefined();
  });

  it("falls back to 401 with no session when no discovery backend is configured", async () => {
    const response = await postInitialize(withoutBackend.baseUrl);

    expect(response.status).toBe(401);
    expect(response.headers.get("mcp-session-id")).toBeNull();
    expect(withoutBackend.bundler.getSessionCount()).toBe(0);
  });

  it("invokes cleanup (removes the session from the registry) when SHUTDOWN fires on an anonymous session", async () => {
    const response = await postInitialize(withBackend.baseUrl);
    const sessionId = response.headers.get("mcp-session-id")!;
    const session = withBackend.bundler.getSession(sessionId);
    expect(session).toBeDefined();

    session!.emit(SESSION_EVENTS.SHUTDOWN);

    // cleanupSession is async (awaits session.close()) - give its promise
    // chain a tick to run before asserting the registry was cleared.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(withBackend.bundler.getSession(sessionId)).toBeUndefined();
  });
});
