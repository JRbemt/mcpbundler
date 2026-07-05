/**
 * Session State Store
 *
 * Holds session-scoped decision-state that is plain, serializable data with
 * no connection attached - e.g. resumption tokens, LLM-router ranking
 * history. This is distinct from a Session's upstream connector map, which
 * holds live sockets/SSE streams and stays process-affine by necessity.
 *
 * InMemorySessionStateStore preserves today's runtime behavior exactly (the
 * state previously lived in plain class fields on Session/BundlerMiddleware
 * instances, which are already process-local). Moving it behind this
 * interface means a future Redis- or Postgres-backed implementation is an
 * additive change, not a rewrite - gated on an actual multi-instance
 * deployment need rather than built speculatively now.
 */
export interface SessionStateStore {
    get<T>(sessionId: string, key: string): Promise<T | undefined>;
    set<T>(sessionId: string, key: string, value: T): Promise<void>;
    delete(sessionId: string, key?: string): Promise<void>;
}

export class InMemorySessionStateStore implements SessionStateStore {
    private readonly store = new Map<string, Map<string, unknown>>();

    async get<T>(sessionId: string, key: string): Promise<T | undefined> {
        return this.store.get(sessionId)?.get(key) as T | undefined;
    }

    async set<T>(sessionId: string, key: string, value: T): Promise<void> {
        let bucket = this.store.get(sessionId);
        if (!bucket) {
            bucket = new Map();
            this.store.set(sessionId, bucket);
        }
        bucket.set(key, value);
    }

    async delete(sessionId: string, key?: string): Promise<void> {
        if (key === undefined) {
            this.store.delete(sessionId);
            return;
        }
        this.store.get(sessionId)?.delete(key);
    }
}
