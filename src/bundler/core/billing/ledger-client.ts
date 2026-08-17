/**
 * Ledger Client - talks to the backend's token ledger reconcile endpoint.
 *
 * Mirrors the fetch/timeout/error shape of
 * src/bundler/core/resolver/api-bundle-resolver.ts: network failures and
 * non-2xx responses both collapse to null rather than throwing, so a
 * caller (TokenSpendCheckMiddleware) can implement a single fail-open/
 * fail-closed policy at the call site instead of catching exceptions in
 * two places. A non-null result's `rejected` flag is a separate, distinct
 * signal from null - null means "no information," rejected:true means
 * "the backend positively confirmed this debit cannot be recorded."
 */
import logger from "../../../shared/utils/logger.js";

const RECONCILE_TIMEOUT_MS = 10_000;

export interface ReconcileResult {
  balance: number;
  rejected: boolean;
}

export class LedgerClient {
  constructor(private readonly backendUrl: string) { }

  /**
   * Report `consumed` tokens spent locally since the last reconcile (0 for
   * a pure balance read) and return the caller's fresh token balance plus
   * whether the backend rejected recording this debit as insufficient.
   */
  async reconcile(accessToken: string, consumed: number): Promise<ReconcileResult | null> {
    const url = `${this.backendUrl}/v1/bundler/ledger/reconcile`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ consumed }),
        signal: AbortSignal.timeout(RECONCILE_TIMEOUT_MS),
      });
    } catch (cause) {
      logger.warn({ url, cause }, "Ledger reconcile request failed");
      return null;
    }

    if (!response.ok) {
      logger.warn({ url, status: response.status }, "Ledger reconcile request failed");
      return null;
    }

    // Parsing stays inside the try below rather than after it: a 200 with a
    // non-JSON or non-object body must collapse to null like every other
    // failure mode here, not reject - a caller in the fire-and-forget batch-
    // flush chain has no .catch() of its own, and an unhandled rejection
    // there would crash the process under Node's default
    // --unhandled-rejections=throw.
    try {
      const data = await response.json();
      if (typeof data?.balance !== "number" || typeof data?.rejected !== "boolean") {
        logger.warn({ url, data }, "Ledger reconcile response had an unexpected shape");
        return null;
      }
      return { balance: data.balance, rejected: data.rejected };
    } catch (cause) {
      logger.warn({ url, cause }, "Ledger reconcile response body could not be parsed");
      return null;
    }
  }
}
