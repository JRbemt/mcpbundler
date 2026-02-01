/**
 * Domain Events
 *
 * Events raised by domain entities to signal state changes.
 * Uses enum + payload pattern for consistency with UPSTREAM_EVENTS.
 */
export const SESSION_EVENTS = {
    ESTABLISHED: "session.established",
    TERMINATED: "session.terminated",
};
export const DOMAIN_EVENTS = {
    ...SESSION_EVENTS,
    UPSTREAM_CONNECTED: "upstream.connected",
    UPSTREAM_DISCONNECTED: "upstream.disconnected",
};
/**
 * Factory functions to create event payloads
 */
export const createSessionEstablished = (sessionId: string, bundleId: string) => ({
    eventType: SESSION_EVENTS.ESTABLISHED,
    occurredAt: new Date(),
    sessionId,
    bundleId,
});
export const createSessionTerminated = (sessionId: string, reason: string) => ({
    eventType: SESSION_EVENTS.TERMINATED,
    occurredAt: new Date(),
    sessionId,
    reason,
});
export const createUpstreamConnected = (sessionId: string, namespace: string, url: string) => ({
    eventType: DOMAIN_EVENTS.UPSTREAM_CONNECTED,
    occurredAt: new Date(),
    sessionId,
    namespace,
    url,
});
export const createUpstreamDisconnected = (sessionId: string, namespace: string, reason: string) => ({
    eventType: DOMAIN_EVENTS.UPSTREAM_DISCONNECTED,
    occurredAt: new Date(),
    sessionId,
    namespace,
    reason,
});
