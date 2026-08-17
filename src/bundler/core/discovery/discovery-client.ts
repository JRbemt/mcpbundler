import { getServiceToken } from "./service-token.js";
import logger from "../../../shared/utils/logger.js";

export interface PublicBundleSummary {
  id: string;
  name: string;
  description: string | null;
  ownerName: string;
  mcpCount: number;
  tags: string[];
  entryPreviews: Array<{ alias: string; title: string }>;
}

export interface PublicBundleDetail {
  id: string;
  name: string;
  description: string | null;
  entries: Array<{ alias: string; title: string; authStrategy: string }>;
}

const REQUEST_TIMEOUT_MS = 10_000;

export class DiscoveryClient {
  constructor(private readonly backendUrl: string) {}

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await getServiceToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async searchBundles(_query: string, count = 20): Promise<PublicBundleSummary[]> {
    const url = `${this.backendUrl}/v1/discover/bundles?_count=${encodeURIComponent(count)}`;
    try {
      const response = await fetch(url, {
        headers: await this.authHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn({ url, status: response.status }, "Discovery search request failed");
        return [];
      }

      const data = await response.json();
      const items = Array.isArray(data?.items) ? data.items : [];
      return items.map((b: any) => ({
        id: b.id,
        name: b.name,
        description: b.description ?? null,
        ownerName: b.owner_name,
        mcpCount: b.mcp_count,
        tags: b.tags ?? [],
        entryPreviews: (b.entry_previews ?? []).map((e: any) => ({ alias: e.alias, title: e.title })),
      }));
    } catch (cause) {
      logger.warn({ url, cause }, "Discovery search request failed");
      return [];
    }
  }

  async getBundle(id: string): Promise<PublicBundleDetail | null> {
    const url = `${this.backendUrl}/v1/bundles/public/${encodeURIComponent(id)}`;
    try {
      const response = await fetch(url, {
        headers: await this.authHeaders(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn({ url, status: response.status }, "Discovery get-bundle request failed");
        return null;
      }

      const b = await response.json();
      const entries = Array.isArray(b?.entries) ? b.entries : [];
      return {
        id: b.id,
        name: b.name,
        description: b.description ?? null,
        entries: entries.map((e: any) => ({
          alias: e.alias,
          title: e.listing?.title ?? e.alias,
          authStrategy: e.auth_strategy,
        })),
      };
    } catch (cause) {
      logger.warn({ url, cause }, "Discovery get-bundle request failed");
      return null;
    }
  }
}
