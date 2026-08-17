// Bounds how many times an anonymous session may call specific
// bundler-native tools within a rolling time window. The mcpLimiter in
// bundler-mcp-routes.ts already rate-limits new /mcp connections per IP,
// but nothing previously capped tool-call volume inside one already-open
// anonymous session - a single session could otherwise call a middleware-
// owned tool without limit.
//
// Implemented as its own handleOwnToolCall, not onBeforeToolCall:
// MiddlewareChain.handleOwnToolCall (middleware-chain.ts) is first-match-
// wins across the session's middleware chain, so registering this
// middleware ahead of the tool-owning middleware in the session's chain
// lets it veto a call before the real handler ever executes - a plain
// onBeforeToolCall implementation would work too (it now runs even earlier,
// before handleOwnToolCall is reached at all), but this middleware predates
// that guarantee and there is no reason to move it.
import { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { AbstractBundlerMiddleware, MiddlewareContext } from "./middleware.js";
import { SessionStateStore } from "../session/session-state-store.js";
import logger from "../../../shared/utils/logger.js";

export interface RateLimitRule {
  /** Unique among all rules passed to one middleware instance - used as the SessionStateStore key suffix. */
  id: string;
  /** Tool names this rule governs, matched by exact params.name equality. */
  toolNames: string[];
  /** Maximum calls allowed within windowMs, counted per session. */
  maxCalls: number;
  windowMs: number;
}

interface RateLimitState {
  /** Epoch ms timestamps of calls counted within the current, still-open window - pruned lazily on each check. */
  callTimestamps: number[];
}

function stateKey(ruleId: string): string {
  return `anonymous-rate-limit:${ruleId}`;
}

function formatWindow(windowMs: number): string {
  if (windowMs % 60_000 === 0) {
    return `${windowMs / 60_000}m`;
  }
  return `${Math.round(windowMs / 1000)}s`;
}

export class AnonymousRateLimitMiddleware extends AbstractBundlerMiddleware {
  readonly name = "anonymous-rate-limit";

  constructor(
    private readonly rules: RateLimitRule[],
    private readonly store: SessionStateStore,
  ) {
    super();
  }

  async handleOwnToolCall(
    params: CallToolRequest["params"],
    ctx: MiddlewareContext,
  ): Promise<CallToolResult | null> {
    const rule = this.rules.find((r) => r.toolNames.includes(params.name));
    if (!rule) return null; // Not a governed tool - defer to the tool's own middleware.

    // Fails closed: MiddlewareChain.handleOwnToolCall treats a thrown error
    // from any one middleware as "this middleware doesn't own this call"
    // and moves on to the next (see middleware-chain.ts) - left unguarded,
    // a SessionStateStore outage would silently disable rate limiting for
    // every anonymous session at exactly the moment abuse is most likely to
    // be driving that outage. Catching here and returning the same
    // rate-limit-exceeded shape denies the call instead of silently
    // admitting it.
    try {
      const key = stateKey(rule.id);
      const now = Date.now();
      const state = (await this.store.get<RateLimitState>(ctx.sessionId, key)) ?? { callTimestamps: [] };
      const windowStart = now - rule.windowMs;
      const withinWindow = state.callTimestamps.filter((ts) => ts > windowStart);

      if (withinWindow.length >= rule.maxCalls) {
        const oldestInWindow = withinWindow[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestInWindow + rule.windowMs - now) / 1000));
        return {
          content: [{
            type: "text",
            text:
              `Rate limit exceeded for "${params.name}": max ${rule.maxCalls} calls per ${formatWindow(rule.windowMs)} ` +
              `per session. Try again in about ${retryAfterSeconds}s.`,
          }],
          isError: true,
        };
      }

      withinWindow.push(now);
      await this.store.set(ctx.sessionId, key, { callTimestamps: withinWindow });
      return null; // Under the limit - let the owning middleware handle the call.
    } catch (cause) {
      logger.warn({ sessionId: ctx.sessionId, toolName: params.name, cause }, "Rate limit state store failed, denying call (fail closed)");
      return {
        content: [{
          type: "text",
          text: `Unable to verify rate limit for "${params.name}" right now. Try again shortly.`,
        }],
        isError: true,
      };
    }
  }
}
