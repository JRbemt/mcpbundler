import { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AbstractBundlerMiddleware, MiddlewareContext } from "../middleware.js";
import { LedgerClient, ReconcileResult } from "../../billing/ledger-client.js";
import { InMemorySessionStateStore, SessionStateStore } from "../../session/session-state-store.js";
import logger from "../../../../shared/utils/logger.js";

export interface TokenSpendCheckConfig {
  ledgerClient: LedgerClient;
  /** Defaults to a private InMemorySessionStateStore when omitted (e.g. in tests). */
  store?: SessionStateStore;
}

interface TokenBucketState {
  balance: number;
  consumedSinceReconcile: number;
}

// v1 pricing is flat: every tool call costs exactly one token. Per-operation
// cost differentiation is explicitly deferred alongside real per-MCP pricing
// (see the design spec's "Explicitly deferred" section).
const TOKENS_PER_CALL = 1;

// Push the accumulated local debit back to the backend at least this often,
// so a session that never runs its cached balance to zero still keeps the
// ledger reasonably fresh instead of only reconciling at session end. Also
// bounds how much a single session can overspend past what the backend has
// actually confirmed affordable to at most RECONCILE_BATCH_SIZE - 1 tokens
// before the backend's own atomic check (see
// TokenLedgerProvider.record_usage_debit) can catch it. Also doubles as the
// ceiling on the locally-cached balance itself (see seedBucket and
// applyReconcileResult) - without that second use, N concurrent sessions
// under one bundle token would each cache the full reported balance and
// could independently spend up to it before their own first reconcile,
// letting a large true balance amplify the overspend far past this
// per-session bound instead of staying the same order of magnitude as it.
const RECONCILE_BATCH_SIZE = 5;

const BUCKET_STATE_KEY = "tokenBucket";

/**
 * Flat, v1 token spend check, installed on a real bundle session when
 * BUNDLER_TOKEN_BILLING_ENABLED is on (never the anonymous discovery
 * session, which has no upstreams and nothing to bill - see
 * BundlerServer.installSpendCheckMiddleware for both gates). Caches a
 * balance snapshot per session in SessionStateStore (token-bucket pattern)
 * so most calls decrement a local number instead of round-tripping to the
 * backend -
 * only the first call in a session, a call made while the local balance
 * reads empty, and every RECONCILE_BATCH_SIZEth call touch the network.
 *
 * This cache is an optimization only - the backend
 * (TokenLedgerProvider.record_usage_debit) is the sole atomic, authoritative
 * enforcer of "balance never goes negative." A reconcile result with
 * rejected: true always wins over whatever this cache currently believes:
 * the session is clamped to a clean exhausted state ({ balance: 0,
 * consumedSinceReconcile: 0 }) rather than trusting any raw number the
 * rejection response carried as still spendable - see applyReconcileResult.
 *
 * The balance a session ever caches locally - seedBucket, every non-rejected
 * applyReconcileResult, AND applyBatchReconcileResult's merge - is capped to
 * RECONCILE_BATCH_SIZE regardless of how large the backend's true reported
 * balance is (see the constant's own comment for why). Capping only the
 * cold-start/low-balance paths and leaving the periodic batch-flush merge
 * uncapped would not actually bound anything past the session's first
 * RECONCILE_BATCH_SIZE calls: result.balance there is the account's full
 * true balance, not a delta, so the cache would revert to that true,
 * uncapped number the moment any flush resolved - reopening the same
 * overspend window this cap exists to close, just delayed by one batch
 * instead of happening at cold start. This is a mitigation, not a full fix:
 * it bounds how much a single session's cache can overspend for its entire
 * lifetime now, not just at cold start, but does nothing to stop N
 * concurrent sessions under the same bundle token from each independently
 * spending up to that same per-session bound before their own first
 * reconcile lands. Closing that residual multi-session multiplier down to a
 * single session's worth of slop needs genuine per-request atomic
 * reservation against the backend ledger, which is a larger, separately
 * reviewable change.
 *
 * Fail-open/fail-closed policy for an *unreachable* backend (a `null`
 * reconcile result, distinct from an explicit `rejected: true`): fails OPEN
 * (allows the call) only when there is no cached signal yet at all (cold
 * start) - a transient backend outage should degrade to untracked usage for
 * that session, not a total tool-call outage, and the periodic reconcile
 * self-heals once the backend recovers. Once a real depleted balance has
 * actually been observed, an unreachable backend fails CLOSED (rejects) -
 * there is no benefit of the doubt left to extend once the balance is
 * already known to be empty.
 *
 * The batch-flush reconcile (fired when consumedSinceReconcile reaches
 * RECONCILE_BATCH_SIZE) is not awaited by checkAndDebit, so further calls
 * can land - and persist their own bucket state - before it resolves.
 * applyBatchReconcileResult merges its outcome into whatever the store
 * currently holds instead of overwriting it with a value snapshotted at
 * fire time, and the fire itself is skipped entirely while one is already
 * in flight (see hasInFlightBatchReconcile) - together these ensure tokens
 * consumed during that window are never silently dropped from
 * consumedSinceReconcile, only ever carried forward.
 *
 * The low-balance path never fires its own reconcile while a batch flush is
 * still outstanding - it awaits inFlightBatchReconcile (which now resolves
 * only once that flush's own merge has actually landed in the store) and
 * re-reads the bucket, rather than reporting bucket.consumedSinceReconcile
 * again itself. That counter was not yet reset by the pending flush, so an
 * unconditional fresh call here would report the same already-in-flight
 * consumption a second time - not lost tokens, but double-billed ones,
 * since each reconcile call appends its own debit entry on the backend
 * rather than replacing a prior one. Only once the merge has landed and the
 * bucket has been re-read does the low-balance path fire a call of its own,
 * reporting only whatever consumption remains outstanding after that merge.
 *
 * onBeforeToolCall itself runs serialized per session (see runSerialized) -
 * a client is free to pipeline several tools/call requests for the same
 * session before waiting on earlier responses, and without serializing the
 * read-decrement-write here, two such calls could both read the same
 * cached bucket and have the second store.set overwrite the first,
 * dropping one call's consumption entirely. The batch-flush reconcile
 * itself stays unawaited and outside this queue, so it never blocks the
 * next tool call from proceeding while a network round-trip is pending.
 *
 * teardown() reports whatever consumedSinceReconcile is still pending when
 * the session ends, closing the gap a purely periodic batch flush leaves
 * open: a session that never reaches RECONCILE_BATCH_SIZE calls before
 * closing would otherwise have that consumption discarded outright, since
 * Session.close() purges the SessionStateStore entry this middleware's
 * bucket lives in immediately after tearing down the middleware chain.
 * Left unpatched, an agent could open a session, spend up to
 * RECONCILE_BATCH_SIZE - 1 tokens' worth of calls, and close before any
 * flush fires - repeating this indefinitely for unlimited, never-billed
 * usage against any account with a positive balance. teardown() receives
 * no MiddlewareContext, so lastSessionId/lastAccessToken (updated on every
 * checkAndDebit) are the only way it can know what to report against.
 */
export class TokenSpendCheckMiddleware extends AbstractBundlerMiddleware {
  readonly name = "token-spend-check";

  private readonly ledgerClient: LedgerClient;
  private readonly store: SessionStateStore;

  // Resolves only once a batch flush's network call AND its own
  // applyBatchReconcileResult merge have both completed - not merely once
  // the network call returns. Used two ways: to stop a second batch flush
  // from firing while one is still outstanding (see hasInFlightBatchReconcile),
  // and by the low-balance path in checkAndDebit to wait for that merge to
  // land before deciding whether it still needs a reconcile of its own -
  // see the class docstring for why awaiting only the raw network call
  // would not be enough.
  private inFlightBatchReconcile: Promise<void> | null = null;

  // Serializes the read-decrement-write below per session: SessionStateStore
  // has no locking of its own, so two tool calls pipelined for the same
  // session (a client is free to send several tools/call requests before
  // waiting on earlier responses) could otherwise both read the same cached
  // bucket, both compute a decremented copy, and have the second store.set
  // overwrite the first - silently dropping one call's consumption from
  // consumedSinceReconcile forever (spent, never reported, never billed).
  // Keyed by session id, so only calls within the SAME session queue behind
  // each other; unrelated sessions never wait on one another.
  private readonly sessionQueues = new Map<string, Promise<unknown>>();

  // Snapshot of the most recently processed call's identity, kept purely so
  // teardown() - which the BundlerMiddleware interface calls with no
  // MiddlewareContext at all - knows which session's bucket to flush and
  // which access token to report it against. One middleware instance lives
  // for exactly one session's whole lifetime (installSpendCheckMiddleware
  // constructs a fresh instance per session), so these never need to track
  // more than a single session's identity.
  private lastSessionId: string | null = null;
  private lastAccessToken: string | null = null;

  constructor(config: TokenSpendCheckConfig) {
    super();
    this.ledgerClient = config.ledgerClient;
    this.store = config.store ?? new InMemorySessionStateStore();
  }

  async onBeforeToolCall(
    params: CallToolRequest["params"],
    ctx: MiddlewareContext,
  ): Promise<CallToolResult | void> {
    try {
      return await this.runSerialized(ctx.sessionId, () => this.checkAndDebit(params, ctx));
    } catch (cause) {
      // MiddlewareChain's own catch would otherwise treat this as
      // "skip this middleware, let the call through" - the correct default
      // for most middleware, but wrong here: a spend-check failure must
      // never silently become unmetered access. Mirrors
      // AnonymousRateLimitMiddleware's own guard for the same reason.
      logger.error({ sessionId: ctx.sessionId, cause }, "Token spend check failed; failing closed");
      return this.rejection(params.name, 0);
    }
  }

  /**
   * Chains `fn` onto the tail of this session's queue so it only starts
   * once every call queued ahead of it has settled - a rejected/errored
   * predecessor still lets the queue advance, since the handler here is
   * chained onto both the fulfillment and rejection branches of `previous`.
   * Drops the map entry once nothing further is queued behind this call,
   * so a long-lived process does not accumulate one entry per session ever
   * seen.
   */
  private runSerialized<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve();
    const result = previous.then(fn, fn);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.sessionQueues.set(sessionId, settled);
    void settled.then(() => {
      if (this.sessionQueues.get(sessionId) === settled) {
        this.sessionQueues.delete(sessionId);
      }
    });
    return result;
  }

  private async checkAndDebit(
    params: CallToolRequest["params"],
    ctx: MiddlewareContext,
  ): Promise<CallToolResult | void> {
    this.lastSessionId = ctx.sessionId;
    this.lastAccessToken = ctx.accessToken;

    let bucket = await this.store.get<TokenBucketState>(ctx.sessionId, BUCKET_STATE_KEY);

    if (!bucket) {
      bucket = await this.seedBucket(ctx.sessionId, ctx.accessToken);
    }

    if (bucket.balance <= 0) {
      if (this.inFlightBatchReconcile) {
        // A batch flush already claimed reporting (some or all of)
        // bucket.consumedSinceReconcile to the backend - wait for its merge
        // to land rather than firing a second call that would report the
        // same still-unreset consumedSinceReconcile a second time (see the
        // class docstring). Re-read afterward instead of trusting a value
        // computed before this await.
        await this.inFlightBatchReconcile;
        bucket = (await this.store.get<TokenBucketState>(ctx.sessionId, BUCKET_STATE_KEY)) ?? bucket;
      }
      if (bucket.balance <= 0) {
        // A dedicated call reporting only what remains outstanding after
        // the merge above (or, if no flush was in flight, exactly
        // bucket.consumedSinceReconcile as it stands) - applyReconcileResult
        // resets that counter to 0 on success, so it must reflect the true
        // current remainder, not something already accounted for elsewhere.
        const result = await this.ledgerClient.reconcile(ctx.accessToken, bucket.consumedSinceReconcile);
        const reportedBalance = result?.balance ?? bucket.balance;
        bucket = await this.applyReconcileResult(ctx.sessionId, result, bucket);
        if (bucket.balance <= 0) {
          return this.rejection(params.name, reportedBalance);
        }
      }
    }

    bucket = {
      balance: bucket.balance - TOKENS_PER_CALL,
      consumedSinceReconcile: bucket.consumedSinceReconcile + TOKENS_PER_CALL,
    };
    await this.store.set(ctx.sessionId, BUCKET_STATE_KEY, bucket);

    // The hasInFlightBatchReconcile guard matters: without it, every call
    // while consumedSinceReconcile stays >= RECONCILE_BATCH_SIZE (which it
    // does until the in-flight call resolves and applyBatchReconcileResult
    // brings the counter back down) would fire its own batch reconcile,
    // stacking up duplicate in-flight requests to the backend for the same
    // session. Skipping the fire entirely while one is already in flight
    // means at most one batch reconcile is ever outstanding, and the next
    // call after it resolves re-checks the threshold and fires fresh if
    // still needed.
    if (bucket.consumedSinceReconcile >= RECONCILE_BATCH_SIZE && !this.hasInFlightBatchReconcile()) {
      const sessionId = ctx.sessionId;
      const accessToken = ctx.accessToken;
      const consumedAtFireTime = bucket.consumedSinceReconcile;
      // Not awaited here - checkAndDebit returns immediately and further
      // tool calls for this session can run (and persist their own bucket
      // updates) before this resolves. applyReconcileResult overwrites the
      // store outright, which is only safe when nothing else can have
      // written to it in the meantime (true for the synchronous, awaited
      // call in the low-balance branch above, false here) -
      // applyBatchReconcileResult merges instead, so tokens consumed while
      // this call was in flight are never silently dropped from
      // consumedSinceReconcile. inFlightBatchReconcile tracks this whole
      // chain, merge included, so a later low-balance check that awaits it
      // is guaranteed the merge has landed before it re-reads the bucket.
      this.inFlightBatchReconcile = this.ledgerClient
        .reconcile(accessToken, consumedAtFireTime)
        .then((result) => this.applyBatchReconcileResult(sessionId, result, consumedAtFireTime))
        .finally(() => {
          this.inFlightBatchReconcile = null;
        });
    }
  }

  private hasInFlightBatchReconcile(): boolean {
    return this.inFlightBatchReconcile !== null;
  }

  private rejection(toolName: string, balance: number): CallToolResult {
    return {
      content: [{
        type: "text",
        text: `Insufficient token balance to run "${toolName}". Current balance: ${balance} tokens. `
          + "Purchase more tokens (Stripe credit or x402 payment) or wait for your subscription's next billing period.",
      }],
      isError: true,
      structuredContent: { reason: "insufficient_balance", balance },
    };
  }

  /**
   * Folds a reconcile outcome into the next cached bucket state and
   * persists it. `result === null` (backend unreachable) keeps whatever
   * the caller passes as `fallback` unchanged. `result.rejected === true`
   * always clamps to a clean exhausted state ({ balance: 0,
   * consumedSinceReconcile: 0 }) rather than reusing `result.balance` as a
   * fresh spendable number - the next call will re-probe the real balance
   * from a zero-pending-local-consumption baseline instead of this
   * middleware silently handing back an allowance nothing has verified is
   * still safe to spend. A successful (non-rejected) result always resets
   * consumedSinceReconcile to 0, since the backend has just confirmed
   * everything reported so far is accounted for.
   */
  private async applyReconcileResult(
    sessionId: string,
    result: ReconcileResult | null,
    fallback: TokenBucketState,
  ): Promise<TokenBucketState> {
    const next: TokenBucketState =
      result === null
        ? fallback
        : result.rejected
          ? { balance: 0, consumedSinceReconcile: 0 }
          // Capped to RECONCILE_BATCH_SIZE regardless of the true reported
          // balance - a session never locally believes it can spend more
          // than one batch's worth before its own next reconcile, no
          // matter how large the account's real balance is. Closes the
          // "large balance amplifies a multi-session overspend" property;
          // see the class docstring for the residual this does not close.
          : { balance: Math.min(result.balance, RECONCILE_BATCH_SIZE), consumedSinceReconcile: 0 };
    await this.store.set(sessionId, BUCKET_STATE_KEY, next);
    return next;
  }

  /**
   * Folds a batch reconcile's outcome into whatever the session's bucket
   * currently holds in the store, rather than overwriting it with a value
   * snapshotted before the call was fired (applyReconcileResult's
   * approach, safe only when nothing else could have written to the store
   * in the meantime). The batch-reconcile call site does not await its
   * result, so further tool calls can run - and persist their own
   * balance/consumedSinceReconcile updates - before this resolves.
   * Overwriting at that point would silently drop whatever those
   * intervening calls consumed: tokens actually spent (the tool ran) but
   * never reported to the backend and never billed, permanently.
   *
   * Reads the bucket fresh and subtracts exactly consumedAtFireTime - the
   * amount this specific reconcile call reported - leaving anything
   * consumed after it fired untouched and still pending for the next
   * reconcile.
   */
  private async applyBatchReconcileResult(
    sessionId: string,
    result: ReconcileResult | null,
    consumedAtFireTime: number,
  ): Promise<void> {
    if (result === null) {
      // Nothing was reported - the store already reflects everything
      // consumed so far, including anything added since this call fired.
      return;
    }

    const current = await this.store.get<TokenBucketState>(sessionId, BUCKET_STATE_KEY);
    if (!current) return; // Session ended / state cleared while this was in flight.

    const stillUnreported = Math.max(0, current.consumedSinceReconcile - consumedAtFireTime);

    if (result.rejected) {
      await this.store.set(sessionId, BUCKET_STATE_KEY, { balance: 0, consumedSinceReconcile: stillUnreported });
      return;
    }

    // result.balance is the account's full true balance, not a delta -
    // capping here the same way seedBucket/applyReconcileResult do keeps
    // the local cache bounded to one batch's worth of unconfirmed spend
    // after every flush, not just at cold start. Leaving this uncapped
    // would let a session's cache revert to the true (potentially huge)
    // balance the moment any batch flush resolves, reopening the same
    // multi-session overspend window this cap exists to close - just
    // delayed by one batch instead of happening immediately.
    await this.store.set(sessionId, BUCKET_STATE_KEY, {
      balance: Math.min(result.balance - stillUnreported, RECONCILE_BATCH_SIZE),
      consumedSinceReconcile: stillUnreported,
    });
  }

  private async seedBucket(sessionId: string, accessToken: string): Promise<TokenBucketState> {
    const result = await this.ledgerClient.reconcile(accessToken, 0);
    if (result === null) {
      logger.warn({ sessionId }, "Ledger reconcile unreachable on session start; failing open");
    }
    const bucket: TokenBucketState =
      result === null
        ? { balance: Number.POSITIVE_INFINITY, consumedSinceReconcile: 0 }
        // Unreachable in practice - the backend never rejects a consumed=0
        // reconcile (record_usage_debit treats consumed<=0 as a pure,
        // always-successful balance read). Still handled explicitly rather
        // than assumed impossible: an unchecked "this can never happen"
        // assumption is exactly the kind of gap that goes unnoticed until
        // it doesn't.
        : result.rejected
          ? { balance: 0, consumedSinceReconcile: 0 }
          // Capped to RECONCILE_BATCH_SIZE regardless of the true reported
          // balance - a session never locally believes it can spend more
          // than one batch's worth before its own next reconcile, no
          // matter how large the account's real balance is. Closes the
          // "large balance amplifies a multi-session overspend" property;
          // see the class docstring for the residual this does not close.
          : { balance: Math.min(result.balance, RECONCILE_BATCH_SIZE), consumedSinceReconcile: 0 };
    await this.store.set(sessionId, BUCKET_STATE_KEY, bucket);
    return bucket;
  }

  /**
   * Flushes whatever consumedSinceReconcile is still pending when the
   * session ends. Session.close() calls MiddlewareChain.teardown() and
   * then immediately purges the SessionStateStore entry this middleware's
   * bucket lives in - without this override, any consumption sitting in
   * the local cache below RECONCILE_BATCH_SIZE (never enough to have
   * triggered a periodic flush) would simply vanish, never reported to the
   * backend and never billed. See the class docstring for the exploit this
   * closes.
   *
   * Best-effort only: MiddlewareChain.teardown() already runs each
   * middleware's teardown in its own try/catch and logs rather than
   * throws (see middleware-chain.ts), so a failure here - the backend
   * being unreachable, the reconcile call rejecting, anything - can never
   * block or delay session close. There is also nothing to write back to
   * the store on success: seedBucket/applyReconcileResult's usual job of
   * keeping the cache consistent for the *next* call does not apply here,
   * since Session.close() purges the store immediately after teardown
   * regardless of what this call reports.
   */
  async teardown(): Promise<void> {
    if (this.lastSessionId === null || this.lastAccessToken === null) {
      // onBeforeToolCall never ran for this session - nothing was ever
      // consumed locally, so there is nothing pending to flush.
      return;
    }
    if (this.inFlightBatchReconcile) {
      // A batch flush already claimed reporting (some or all of) the
      // pending consumption to the backend - wait for its merge to land
      // rather than racing it and reporting the same still-unreset
      // consumedSinceReconcile a second time (mirrors the low-balance
      // branch of checkAndDebit, which awaits this same promise for the
      // same reason). The chain's own reconcile call already collapses
      // network/parse failures to null rather than throwing (see
      // LedgerClient.reconcile), so this await does not need its own
      // catch to stay non-blocking.
      await this.inFlightBatchReconcile;
    }
    const bucket = await this.store.get<TokenBucketState>(this.lastSessionId, BUCKET_STATE_KEY);
    if (!bucket || bucket.consumedSinceReconcile <= 0) {
      // Either no bucket was ever seeded, or the last reconcile (seed,
      // low-balance refresh, or batch flush) already reported everything
      // consumed so far - firing again here would double-report it.
      return;
    }
    await this.ledgerClient.reconcile(this.lastAccessToken, bucket.consumedSinceReconcile);
  }
}
