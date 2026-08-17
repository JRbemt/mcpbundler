import type { Session } from "../session.js";
import { MCPConfig } from "../../schemas.js";
import { LoadingStrategy } from "./loading-strategy.js";
import logger from "../../../../shared/utils/logger.js";

/**
 * Attach a set of upstreams to a session concurrently. Each upstream's
 * connection attempt is isolated - one failure does not prevent the others
 * from attaching, matching Session.attachUpstream's own per-namespace error
 * handling and logging.
 */
export async function attachUpstreamsConcurrently(session: Session, configs: MCPConfig[]): Promise<void> {
    const results = await Promise.allSettled(
        configs.map((config) => session.attachUpstream(config))
    );

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") {
            logger.error({
                sessionId: session.id,
                namespace: configs[i].namespace,
                error: result.reason?.message ?? result.reason,
            }, "Failed to attach upstream");
        }
    }
}

/**
 * Attach a stage's upstreams to a session according to its loading
 * strategy.
 *
 * EAGER blocks until every upstream has finished its connection attempt
 * (successful or not), then fires a single list_changed so the very next
 * tools/list response is already complete.
 *
 * PROGRESSIVE returns immediately; each upstream's own attach call notifies
 * the client as it comes online (see Session.attachUpstream's PROGRESSIVE
 * branch) rather than waiting for the whole batch.
 *
 * Shared by the initial session-bootstrap path (bundler-mcp-routes.ts) and
 * Session.transitionTo, so the strategy branching exists in exactly one
 * place regardless of whether upstreams are being attached at session
 * creation or mid-session during a stage transition.
 */
export async function attachStageUpstreams(
    session: Session,
    upstreams: MCPConfig[],
    strategy: LoadingStrategy
): Promise<void> {
    if (strategy === LoadingStrategy.EAGER) {
        await attachUpstreamsConcurrently(session, upstreams);
        session.emitListChanged();
        logger.debug({ sessionId: session.id, strategy, count: upstreams.length }, "All upstreams attached (eager)");
    } else {
        attachUpstreamsConcurrently(session, upstreams)
            .then(() => logger.debug({ sessionId: session.id, strategy, count: upstreams.length }, "All upstreams attached (progressive)"))
            .catch((err: Error) => logger.error({ sessionId: session.id, err: err.message }, "Upstream attach error"));
    }
}
