/**
 * Session Identity Resolver
 *
 * Isolates "how do we identify which session a request belongs to" from the
 * route handlers. Today's only implementation reads the same Mcp-Session-Id
 * header (and, for the deprecated SSE route, the sessionId query param) that
 * bundler-mcp-routes.ts and bundler-sse-routes.ts read inline today - this is
 * a lossless extraction, not a behavior change.
 *
 * The MCP spec revision that removes the protocol-level session (no more
 * initialize handshake, no more Mcp-Session-Id header) will require a second
 * implementation that resolves identity from an explicit handle instead. Only
 * that implementation and its wiring in the route files need to change; the
 * Session domain object and all BundlerMiddleware already operate on an
 * opaque sessionId string.
 */
import { Request } from "express";
import { randomUUID } from "crypto";

export interface SessionIdentityResolver {
    /** Resolve the session id an incoming request belongs to, if any. */
    resolve(req: Request): string | undefined;

    /** Issue a new session id for a request establishing a new session. */
    issue(): string;
}

export class TransportHeaderSessionIdentity implements SessionIdentityResolver {
    resolve(req: Request): string | undefined {
        const header = req.headers["mcp-session-id"];
        if (typeof header === "string") {
            return header;
        }
        const query = req.query?.sessionId;
        return typeof query === "string" ? query : undefined;
    }

    issue(): string {
        return randomUUID();
    }
}
