/**
 * API Bundle Resolver - backend-integrated bundle resolution
 *
 * Implements ResolverService by delegating token validation and bundle resolution
 * to the FastAPI backend via GET /api/v1/bundler/resolve.  This replaces the
 * DBBundleResolver when BACKEND_URL is set, making the backend the single source
 * of truth for bundle configurations and access tokens.
 *
 * The backend response uses snake_case field names and lowercase auth strategy
 * values; this resolver maps them to the camelCase / UPPER_CASE conventions
 * expected by the rest of the bundler.
 */

import { Bundle, BundleRouterConfigSchema, MCPConfigSchema } from "../schemas.js";
import { ResolverService } from "./service.js";
import logger from "../../../shared/utils/logger.js";

export class APIBundleResolver implements ResolverService {
  constructor(private readonly backendUrl: string) { }

  /**
   * Resolve a bundle token by calling the backend resolve endpoint.
   *
   * The token is forwarded as a Bearer credential.  The backend validates it,
   * decrypts auth configs, and returns the full MCP list.
   *
   * @param token - Plaintext bundle access token (e.g. "mcpb_...")
   * @throws Error with `.status` set to the HTTP status code on failure
   */
  async resolveBundle(token: string): Promise<Bundle> {
    const url = `${this.backendUrl}/api/v1/bundler/resolve`;
    logger.debug({ url }, "Resolving bundle via backend API");

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (cause) {
      const err: any = new Error(`Backend unreachable at ${url}`);
      err.status = 503;
      err.cause = cause;
      throw err;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.warn({ status: response.status, body }, "Bundle resolve request failed");
      const err: any = new Error(`Bundle resolve failed: ${response.status}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();

    const upstreams = (data.mcps as any[]).map((mcp) =>
      MCPConfigSchema.parse({
        ...mcp,
        stateless: mcp.stateless ?? false,
        auth: mcp.auth?.method !== "none" ? mcp.auth : undefined,
      })
    );

    let router: Bundle["router"] = undefined;
    if (data.router) {
      const parsed = BundleRouterConfigSchema.safeParse(data.router);
      if (parsed.success) {
        router = parsed.data;
      } else {
        logger.warn({ issues: parsed.error.issues }, "Invalid router config in backend response — ignored");
      }
    }

    logger.info(
      { bundleId: data.bundleId, name: data.name, mcpCount: upstreams.length, routerModel: router?.model },
      "Bundle resolved via backend API"
    );

    return {
      bundleId: data.bundleId,
      name: data.name,
      upstreams,
      router,
    };
  }
}
