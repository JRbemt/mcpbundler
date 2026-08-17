import { describe, it, expect } from "vitest";
import { Session } from "../../../src/bundler/core/session/session.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";

function makeSession(): Session {
    return Session.create(
        "sess-1", "bundle-1", "",
        {} as never, {} as never, {} as never, {} as never,
        new InMemorySessionStateStore(),
    );
}

describe("Session.setAccessToken", () => {
    it("updates the token getMiddlewareContext hands to middleware", () => {
        const session = makeSession();
        expect(session.getMiddlewareContext().accessToken).toBe("");

        session.setAccessToken("tok-real");

        expect(session.getMiddlewareContext().accessToken).toBe("tok-real");
        expect(session.accessToken).toBe("tok-real");
    });
});
