import { describe, it, expect, vi } from "vitest";
import { TokenSpendCheckMiddleware } from "../../../src/bundler/core/middleware/billing/token-spend-check-middleware.js";
import { Session, SessionState } from "../../../src/bundler/core/session/session.js";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";
import type { SessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";
import type { LedgerClient, ReconcileResult } from "../../../src/bundler/core/billing/ledger-client.js";
import type { MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";

function makeCtx(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
    return {
        sessionId: "sess-1",
        bundleId: "bundle-1",
        accessToken: "tok-abc",
        notifyToolsChanged: vi.fn(),
        notifyResourcesChanged: vi.fn(),
        notifyPromptsChanged: vi.fn(),
        attachUpstream: vi.fn().mockResolvedValue(undefined),
        detachUpstream: vi.fn(),
        getAttachedNamespaces: vi.fn().mockReturnValue([]),
        getAvailableUpstreams: vi.fn().mockReturnValue([]),
        ...overrides,
    };
}

function makeLedgerClient(
    reconcile: (accessToken: string, consumed: number) => Promise<ReconcileResult | null>,
): LedgerClient {
    return { reconcile } as unknown as LedgerClient;
}

describe("TokenSpendCheckMiddleware", () => {
    it("seeds the bucket from the backend on the first call and allows it through", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 10, rejected: false });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store: new InMemorySessionStateStore() });

        const result = await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, makeCtx());

        expect(result).toBeUndefined();
        expect(reconcile).toHaveBeenCalledWith("tok-abc", 0);
    });

    it("decrements the cached balance locally on subsequent calls without another network call", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 10, rejected: false });
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        await mw.onBeforeToolCall({ name: "a", arguments: {} }, ctx);
        await mw.onBeforeToolCall({ name: "b", arguments: {} }, ctx);

        expect(reconcile).toHaveBeenCalledOnce();
        const bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        // Seeded balance is capped to RECONCILE_BATCH_SIZE (5), not the raw
        // reported 10, then decremented twice.
        expect(bucket).toEqual({ balance: 3, consumedSinceReconcile: 2 });
    });

    it("fires a background reconcile every RECONCILE_BATCH_SIZE calls and resets the counter on success", async () => {
        const reconcile = vi.fn()
            .mockResolvedValueOnce({ balance: 100, rejected: false })
            .mockResolvedValueOnce({ balance: 94, rejected: false });
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        for (let i = 0; i < 5; i++) {
            await mw.onBeforeToolCall({ name: `tool-${i}`, arguments: {} }, ctx);
        }
        // Let the fire-and-forget reconcile's microtask settle.
        await new Promise((resolve) => setImmediate(resolve));

        expect(reconcile).toHaveBeenCalledTimes(2);
        expect(reconcile).toHaveBeenNthCalledWith(2, "tok-abc", 5);
        const bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        // The batch-flush's reported balance (94) is the account's full true
        // balance, not a delta - capped to RECONCILE_BATCH_SIZE (5) the same
        // way seedBucket/applyReconcileResult are, so the cache never reverts
        // to an uncapped number just because a flush happened to resolve.
        expect(bucket).toEqual({ balance: 5, consumedSinceReconcile: 0 });
    });

    it("caps the batch-flush merge's balance too, not just the cold-start seed", async () => {
        // Distinct from the test above: this uses a starting balance large
        // enough (1000) that if applyBatchReconcileResult's merge were left
        // uncapped, the post-flush balance would be nowhere near
        // RECONCILE_BATCH_SIZE - proving the cap applies on this path
        // specifically, not merely coinciding with a small mock value.
        const reconcile = vi.fn()
            .mockResolvedValueOnce({ balance: 1000, rejected: false })
            .mockResolvedValueOnce({ balance: 995, rejected: false });
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        for (let i = 0; i < 5; i++) {
            await mw.onBeforeToolCall({ name: `tool-${i}`, arguments: {} }, ctx);
        }
        await new Promise((resolve) => setImmediate(resolve));

        const bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        expect(bucket).toEqual({ balance: 5, consumedSinceReconcile: 0 });
    });

    it("rejects the call with a structured error when the cached balance is exhausted", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 0, rejected: false });
        const store = new InMemorySessionStateStore();
        await store.set("sess-1", "tokenBucket", { balance: 0, consumedSinceReconcile: 0 });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });

        const result = await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, makeCtx());

        expect(result?.isError).toBe(true);
        expect((result!.content[0] as { text: string }).text).toContain("Insufficient token balance");
        expect(result?.structuredContent).toEqual({ reason: "insufficient_balance", balance: 0 });
    });

    it("re-checks the backend before rejecting, in case a top-up landed since the cache was last refreshed", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 5, rejected: false });
        const store = new InMemorySessionStateStore();
        await store.set("sess-1", "tokenBucket", { balance: 0, consumedSinceReconcile: 2 });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });

        const result = await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, makeCtx());

        expect(result).toBeUndefined();
        expect(reconcile).toHaveBeenCalledWith("tok-abc", 2);
        const bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        expect(bucket).toEqual({ balance: 4, consumedSinceReconcile: 1 });
    });

    it("rejects the call and clamps local state to exhausted when the backend explicitly rejects the debit", async () => {
        // The backend's true balance (2) cannot cover what this session has
        // already locally consumed since its last reconcile (3) - this is
        // exactly the cross-session double-spend scenario the security
        // review flagged: another session (or this one's own earlier
        // optimistic slop) already spent most of a shared balance.
        const reconcile = vi.fn().mockResolvedValue({ balance: 2, rejected: true });
        const store = new InMemorySessionStateStore();
        await store.set("sess-1", "tokenBucket", { balance: 0, consumedSinceReconcile: 3 });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });

        const result = await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, makeCtx());

        expect(result?.isError).toBe(true);
        // The rejection message reports the backend's real reported balance (2)
        // for the caller's information, even though the cached bucket below is
        // clamped to a clean 0 rather than trusting that number as spendable -
        // see the "Design decisions" note on why a rejection never hands back a
        // fresh-feeling allowance.
        expect(result?.structuredContent).toEqual({ reason: "insufficient_balance", balance: 2 });
        const bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        expect(bucket).toEqual({ balance: 0, consumedSinceReconcile: 0 });
    });

    it("clamps local state to exhausted after a rejected background batch-flush, blocking the next call", async () => {
        const reconcile = vi.fn()
            .mockResolvedValueOnce({ balance: 100, rejected: false }) // seed
            .mockResolvedValueOnce({ balance: 0, rejected: true }) // batch flush at call 5 - another session won the race
            .mockResolvedValueOnce({ balance: 0, rejected: false }); // call 6's own refresh probe (consumed=0)
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        for (let i = 0; i < 5; i++) {
            const result = await mw.onBeforeToolCall({ name: `tool-${i}`, arguments: {} }, ctx);
            expect(result).toBeUndefined();
        }
        await new Promise((resolve) => setImmediate(resolve));

        const sixthResult = await mw.onBeforeToolCall({ name: "tool-5", arguments: {} }, ctx);

        expect(sixthResult?.isError).toBe(true);
        expect(reconcile).toHaveBeenCalledTimes(3);
    });

    it("does not lose tokens consumed while a background batch-flush is still in flight", async () => {
        // The batch-flush at call 5 is deliberately left unresolved so
        // calls 6 and 7 land locally before it completes - this is the
        // exact race applyBatchReconcileResult and the inFlightReconcile
        // guard exist to survive: naively overwriting the store with a
        // value snapshotted when the flush fired would silently drop
        // whatever those two calls consumed.
        let resolveBatchReconcile!: (value: { balance: number; rejected: boolean }) => void;
        const batchReconcilePromise = new Promise<{ balance: number; rejected: boolean }>((resolve) => {
            resolveBatchReconcile = resolve;
        });
        const reconcile = vi.fn()
            .mockReturnValueOnce(batchReconcilePromise); // batch flush at call 5, not yet resolved
        const store = new InMemorySessionStateStore();
        // Pre-populate the bucket directly rather than going through
        // seedBucket, so the starting balance can stay comfortably above
        // RECONCILE_BATCH_SIZE for the full run below - seedBucket's own
        // RECONCILE_BATCH_SIZE cap is covered by its own dedicated test,
        // and would otherwise make the local balance hit exactly zero the
        // instant the batch flush fires, leaving no room to observe calls
        // landing locally while it is still in flight.
        await store.set("sess-1", "tokenBucket", { balance: 100, consumedSinceReconcile: 0 });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        for (let i = 0; i < 5; i++) {
            await mw.onBeforeToolCall({ name: `tool-${i}`, arguments: {} }, ctx);
        }
        // The batch flush for calls 0-4 is now in flight but unresolved.
        await mw.onBeforeToolCall({ name: "tool-5", arguments: {} }, ctx);
        await mw.onBeforeToolCall({ name: "tool-6", arguments: {} }, ctx);

        let bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        expect(bucket).toEqual({ balance: 93, consumedSinceReconcile: 7 });
        // Only one network reconcile call so far (the batch flush itself,
        // there being no seed call this time) - the in-flight guard
        // stopped calls 5 and 6 from firing a second one while the first
        // was still pending.
        expect(reconcile).toHaveBeenCalledTimes(1);

        resolveBatchReconcile({ balance: 95, rejected: false });
        await new Promise((resolve) => setImmediate(resolve));

        bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        // The backend confirmed 95 after debiting the first 5 calls; the
        // two calls that landed while that request was in flight (tool-5,
        // tool-6) remain tracked as still-unreported - consumedSinceReconcile
        // reflects that. The 93-token remainder (95 true balance minus those
        // 2 still-unreported) is capped to RECONCILE_BATCH_SIZE the same way
        // every other merge result is, so the cache never reverts to an
        // uncapped number just because a flush happened to resolve.
        expect(bucket).toEqual({ balance: 5, consumedSinceReconcile: 2 });
    });

    it("waits for an in-flight batch-flush's merge instead of double-reporting the same consumption when the balance hits zero", async () => {
        // The batch-flush at call 4 (consumed=5) is deliberately left
        // unresolved. Call 5 then reads a locally exhausted balance -
        // bucket.consumedSinceReconcile is still 5 (the flush has not
        // resolved yet to reset it), so firing a second reconcile
        // reporting that same 5 would append a second debit entry on the
        // backend for tokens already claimed by the in-flight flush. Call
        // 5 must instead wait for the flush's merge to land, re-read, and
        // only then decide whether it still needs a call of its own.
        let resolveBatchReconcile!: (value: { balance: number; rejected: boolean }) => void;
        const batchReconcilePromise = new Promise<{ balance: number; rejected: boolean }>((resolve) => {
            resolveBatchReconcile = resolve;
        });
        const reconcile = vi.fn()
            .mockResolvedValueOnce({ balance: 5, rejected: false }) // seed
            .mockReturnValueOnce(batchReconcilePromise) // batch flush at call 4 (consumed=5), unresolved
            .mockResolvedValueOnce({ balance: 3, rejected: false }); // call 5's own reconcile for the remainder, once the merge leaves it still exhausted
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        for (let i = 0; i < 5; i++) {
            await mw.onBeforeToolCall({ name: `tool-${i}`, arguments: {} }, ctx);
        }
        // Balance is now locally exhausted (seeded at 5, decremented 5
        // times) and the batch-flush from the 5th call is still pending -
        // call 5 will block inside its own await on that flush.
        const sixthResultPromise = mw.onBeforeToolCall({ name: "tool-5", arguments: {} }, ctx);

        // The backend confirms the flush's 5-token debit but reports
        // nothing left over (balance: 0) - the merge alone is not enough,
        // so call 5 must fire its own reconcile for the remainder.
        resolveBatchReconcile({ balance: 0, rejected: false });
        const sixthResult = await sixthResultPromise;

        expect(sixthResult).toBeUndefined();
        expect(reconcile).toHaveBeenCalledTimes(3);
        // The remainder call reports consumed=0, not 5 - the merge already
        // reset consumedSinceReconcile before this call fired its own.
        expect(reconcile).toHaveBeenNthCalledWith(3, "tok-abc", 0);
        const bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        // 3 (the remainder call's reported balance) minus this call's own
        // 1-token decrement.
        expect(bucket).toEqual({ balance: 2, consumedSinceReconcile: 1 });
    });

    it("caps the locally-cached balance to RECONCILE_BATCH_SIZE even when the backend reports a much larger true balance", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 1_000_000, rejected: false });
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });

        await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, makeCtx());

        const bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        // Seeded balance is capped to RECONCILE_BATCH_SIZE (5), then this
        // call's own decrement brings it to 4 - not 999,999.
        expect(bucket).toEqual({ balance: 4, consumedSinceReconcile: 1 });
    });

    it("fails open (allows the call) when the backend is unreachable on the very first call", async () => {
        const reconcile = vi.fn().mockResolvedValue(null);
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store: new InMemorySessionStateStore() });

        const result = await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, makeCtx());

        expect(result).toBeUndefined();
    });

    it("fails closed when the cached balance already reads empty and the backend is unreachable", async () => {
        const reconcile = vi.fn().mockResolvedValue(null);
        const store = new InMemorySessionStateStore();
        await store.set("sess-1", "tokenBucket", { balance: 0, consumedSinceReconcile: 0 });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });

        const result = await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, makeCtx());

        expect(result?.isError).toBe(true);
    });

    it("serializes two calls pipelined for the same session so neither decrement is lost", async () => {
        // Without serializing the read-decrement-write, both calls read the
        // same cached balance=10 before either writes back, and the second
        // store.set overwrites the first - losing one call's consumption
        // entirely (spent, never reported, never billed).
        const reconcile = vi.fn().mockResolvedValue({ balance: 10, rejected: false });
        const store = new InMemorySessionStateStore();
        await store.set("sess-1", "tokenBucket", { balance: 10, consumedSinceReconcile: 0 });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        const [first, second] = await Promise.all([
            mw.onBeforeToolCall({ name: "a", arguments: {} }, ctx),
            mw.onBeforeToolCall({ name: "b", arguments: {} }, ctx),
        ]);

        expect(first).toBeUndefined();
        expect(second).toBeUndefined();
        const bucket = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        expect(bucket).toEqual({ balance: 8, consumedSinceReconcile: 2 });
    });

    it("does not let calls for one session queue behind another session's calls", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 10, rejected: false });
        const store = new InMemorySessionStateStore();
        await store.set("sess-1", "tokenBucket", { balance: 10, consumedSinceReconcile: 0 });
        await store.set("sess-2", "tokenBucket", { balance: 10, consumedSinceReconcile: 0 });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });

        await Promise.all([
            mw.onBeforeToolCall({ name: "a", arguments: {} }, makeCtx({ sessionId: "sess-1" })),
            mw.onBeforeToolCall({ name: "b", arguments: {} }, makeCtx({ sessionId: "sess-2" })),
        ]);

        const bucket1 = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-1", "tokenBucket");
        const bucket2 = await store.get<{ balance: number; consumedSinceReconcile: number }>("sess-2", "tokenBucket");
        expect(bucket1).toEqual({ balance: 9, consumedSinceReconcile: 1 });
        expect(bucket2).toEqual({ balance: 9, consumedSinceReconcile: 1 });
    });

    it("fails closed, not open, when the state store throws instead of resolving", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 10, rejected: false });
        const store: SessionStateStore = {
            get: vi.fn().mockRejectedValue(new Error("store unreachable")),
            set: vi.fn(),
            delete: vi.fn(),
        };
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });

        const result = await mw.onBeforeToolCall({ name: "github__search", arguments: {} }, makeCtx());

        expect(result?.isError).toBe(true);
        expect(result?.structuredContent).toEqual({ reason: "insufficient_balance", balance: 0 });
    });
});

describe("TokenSpendCheckMiddleware.teardown", () => {
    it("reports the trailing consumedSinceReconcile still pending when the session closes", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 10, rejected: false });
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        // Two calls, both staying under RECONCILE_BATCH_SIZE, so nothing has
        // flushed yet - this is exactly the "session churn" gap: consumption
        // that only ever exists in the local cache.
        await mw.onBeforeToolCall({ name: "a", arguments: {} }, ctx);
        await mw.onBeforeToolCall({ name: "b", arguments: {} }, ctx);
        reconcile.mockClear();

        await mw.teardown();

        expect(reconcile).toHaveBeenCalledWith("tok-abc", 2);
    });

    it("does not reconcile on teardown when no call was ever made", async () => {
        const reconcile = vi.fn().mockResolvedValue({ balance: 10, rejected: false });
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store: new InMemorySessionStateStore() });

        await mw.teardown();

        expect(reconcile).not.toHaveBeenCalled();
    });

    it("does not reconcile on teardown when the last call already flushed everything", async () => {
        // Drive exactly RECONCILE_BATCH_SIZE calls so the batch flush fires
        // and resets consumedSinceReconcile back to 0 before teardown runs.
        const reconcile = vi.fn()
            .mockResolvedValueOnce({ balance: 100, rejected: false }) // seed
            .mockResolvedValueOnce({ balance: 95, rejected: false }); // batch flush
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        for (let i = 0; i < 5; i++) {
            await mw.onBeforeToolCall({ name: `tool-${i}`, arguments: {} }, ctx);
        }
        // Let the fire-and-forget batch reconcile's microtask settle so the
        // merge actually lands and resets consumedSinceReconcile to 0.
        await new Promise((resolve) => setImmediate(resolve));
        reconcile.mockClear();

        await mw.teardown();

        expect(reconcile).not.toHaveBeenCalled();
    });

    it("waits for an in-flight batch-flush's merge instead of double-reporting on teardown", async () => {
        // The batch-flush at call 5 (consumed=5) is deliberately left
        // unresolved when teardown runs - without waiting for it, teardown
        // would read the still-unreset consumedSinceReconcile (5) and
        // report it a second time, double-billing the same consumption the
        // in-flight flush already claimed.
        let resolveBatchReconcile!: (value: { balance: number; rejected: boolean }) => void;
        const batchReconcilePromise = new Promise<{ balance: number; rejected: boolean }>((resolve) => {
            resolveBatchReconcile = resolve;
        });
        const reconcile = vi.fn()
            .mockResolvedValueOnce({ balance: 100, rejected: false }) // seed
            .mockReturnValueOnce(batchReconcilePromise); // batch flush at call 5, unresolved
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const ctx = makeCtx();

        for (let i = 0; i < 5; i++) {
            await mw.onBeforeToolCall({ name: `tool-${i}`, arguments: {} }, ctx);
        }
        reconcile.mockClear();

        const teardownPromise = mw.teardown();
        resolveBatchReconcile({ balance: 95, rejected: false });
        await teardownPromise;

        // The flush already reported everything (consumedSinceReconcile
        // reset to 0 by its merge) - teardown must not fire a redundant
        // call of its own.
        expect(reconcile).not.toHaveBeenCalled();
    });

    it("Session.close() runs the middleware's teardown flush before purging session state", async () => {
        // End-to-end with a real Session and a real TokenSpendCheckMiddleware
        // instance (not a mocked-out middleware) - this is the actual path
        // an unlimited-free-usage exploit walks: open a session, make a
        // couple of calls under the batch threshold, close before any
        // reconcile fires.
        const reconcile = vi.fn().mockResolvedValue({ balance: 10, rejected: false });
        const store = new InMemorySessionStateStore();
        const mw = new TokenSpendCheckMiddleware({ ledgerClient: makeLedgerClient(reconcile), store });
        const now = new Date();
        const session = new Session(
            "sess-close-1", "bundle-1", "tok-abc", now,
            null, null, null, null,
            now, SessionState.Active, store,
        );
        session.addMiddleware(mw);

        await mw.onBeforeToolCall({ name: "a", arguments: {} }, { ...makeCtx(), sessionId: "sess-close-1" });
        await mw.onBeforeToolCall({ name: "b", arguments: {} }, { ...makeCtx(), sessionId: "sess-close-1" });
        reconcile.mockClear();

        await session.close();

        expect(reconcile).toHaveBeenCalledWith("tok-abc", 2);
        // The bucket the flush read from is gone afterward - proving the
        // flush ran (and the assertion above is not accidentally reading
        // from a state that close() itself never touched) before
        // Session.close()'s own store.delete purged it.
        const bucket = await store.get("sess-close-1", "tokenBucket");
        expect(bucket).toBeUndefined();
    });
});
