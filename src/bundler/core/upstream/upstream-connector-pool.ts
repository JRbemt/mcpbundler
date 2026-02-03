/**
 * Upstream Connection Pool
 *
 * Manages pooling of stateless upstream connections for reuse across sessions.
 * Stateful upstreams are not pooled and created per-session.
 */

import logger from "../../../shared/utils/logger.js";
import { IUpstreamConnector } from "./upstream.js";

export class UpstreamConnectionPool {
  private pool = new Map<string, IUpstreamConnector>();

  getPoolKey(namespace: string, url: string): string {
    return `${namespace}:${url}`;
  }

  has(namespace: string, url: string): boolean {
    const poolKey = this.getPoolKey(namespace, url);
    return this.pool.has(poolKey);
  }

  get(namespace: string, url: string): IUpstreamConnector | undefined {
    const poolKey = this.getPoolKey(namespace, url);
    return this.pool.get(poolKey);
  }

  set(namespace: string, url: string, connector: IUpstreamConnector): void {
    const poolKey = this.getPoolKey(namespace, url);
    this.pool.set(poolKey, connector);
    logger.debug({ namespace, url, poolKey }, "Added connector to pool");
  }

  isPooled(connector: IUpstreamConnector): boolean {
    return Array.from(this.pool.values()).includes(connector);
  }

  async shutdown(): Promise<void> {
    logger.info({ poolSize: this.pool.size }, "Shutting down connection pool");

    for (const [poolKey, connector] of this.pool) {
      await connector.disconnect();
      logger.debug({ poolKey }, "Disconnected pooled upstream");
    }

    this.pool.clear();
    logger.info("Connection pool shutdown complete");
  }
}
