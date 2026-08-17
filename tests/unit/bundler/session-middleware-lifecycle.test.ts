import { describe, it, expect, vi } from "vitest";
import { Session, SessionState } from "../../../src/bundler/core/session/session.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";
import { AbstractBundlerMiddleware } from "../../../src/bundler/core/middleware/middleware.js";

class SpyMiddleware extends AbstractBundlerMiddleware {
  constructor(readonly name: string) { super(); }
  teardownSpy = vi.fn(async () => { });
  override async teardown() { return this.teardownSpy(); }
}

class FailingTeardownMiddleware extends AbstractBundlerMiddleware {
  constructor(readonly name: string) { super(); }
  override async teardown(): Promise<void> {
    throw new Error("teardown boom");
  }
}

function makeSession(): Session {
  const now = new Date();
  return new Session(
    "s1", "anonymous", "", now,
    null, null, null, null,
    now, SessionState.Active, new InMemorySessionStateStore()
  );
}

describe("Session.removeMiddleware", () => {
  it("returns true and calls teardown on the removed middleware", async () => {
    const session = makeSession();
    const mw = new SpyMiddleware("a");
    session.addMiddleware(mw);

    const removed = await session.removeMiddleware("a");

    expect(removed).toBe(true);
    expect(mw.teardownSpy).toHaveBeenCalledOnce();
    expect(session.getMiddlewareNames()).not.toContain("a");
  });

  it("returns false and calls no teardown for an unknown name", async () => {
    const session = makeSession();
    const removed = await session.removeMiddleware("missing");
    expect(removed).toBe(false);
  });

  it("does not call teardown on middlewares that remain installed", async () => {
    const session = makeSession();
    const a = new SpyMiddleware("a");
    const b = new SpyMiddleware("b");
    session.addMiddleware(a);
    session.addMiddleware(b);

    await session.removeMiddleware("a");

    expect(a.teardownSpy).toHaveBeenCalledOnce();
    expect(b.teardownSpy).not.toHaveBeenCalled();
  });

  it("does not call teardown a second time when the session later closes", async () => {
    const session = makeSession();
    const a = new SpyMiddleware("a");
    session.addMiddleware(a);

    await session.removeMiddleware("a");
    await session.close();

    expect(a.teardownSpy).toHaveBeenCalledOnce();
  });

  it("still tears down remaining middlewares when the session closes", async () => {
    const session = makeSession();
    const a = new SpyMiddleware("a");
    const b = new SpyMiddleware("b");
    session.addMiddleware(a);
    session.addMiddleware(b);

    await session.removeMiddleware("a");
    await session.close();

    expect(b.teardownSpy).toHaveBeenCalledOnce();
  });

  it("still returns true and removes the middleware from the chain when teardown rejects", async () => {
    const session = makeSession();
    const failing = new FailingTeardownMiddleware("bad-teardown");
    session.addMiddleware(failing);

    const removed = await session.removeMiddleware("bad-teardown");

    expect(removed).toBe(true);
    expect(session.getMiddlewareNames()).not.toContain("bad-teardown");
  });
});
