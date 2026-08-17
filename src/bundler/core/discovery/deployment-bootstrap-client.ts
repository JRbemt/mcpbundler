import logger from "../../../shared/utils/logger.js";

const REQUEST_TIMEOUT_MS = 10_000;

export interface BootstrapResult {
  status: "ready" | "needs_credentials";
  token: string;
  missingCredentials: Array<{ entryId: string; alias: string; entryTitle: string; mcpNamespace: string }>;
}

/**
 * Exchanges a Keycloak-issued JWT (obtained via the device-flow client in
 * this same directory) for a bundle access token, using the backend's
 * deployment bootstrap endpoint - the same _random_token()/BundleAccessToken
 * mechanism the dashboard's generateToken already uses, just reached from an
 * in-protocol agent flow instead of the dashboard UI. A token is present in
 * the response even when status is "needs_credentials" - the deployment is
 * created either way, only some upstream credentials still need a human.
 */
export class DeploymentBootstrapClient {
  constructor(private readonly backendUrl: string) {}

  async bootstrap(keycloakAccessToken: string, bundleId: string): Promise<BootstrapResult | null> {
    const url = `${this.backendUrl}/v1/deployments/bootstrap`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${keycloakAccessToken}`,
        },
        body: JSON.stringify({ bundle_id: bundleId }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        logger.warn({ url, bundleId, status: response.status }, "Deployment bootstrap request failed");
        return null;
      }

      const data = (await response.json()) as {
        status: "ready" | "needs_credentials";
        token: { value: string };
        missing_credentials: Array<{ entry_id: string; alias: string; entry_title: string; mcp_namespace: string }>;
      };

      return {
        status: data.status,
        token: data.token.value,
        missingCredentials: data.missing_credentials.map((c) => ({
          entryId: c.entry_id,
          alias: c.alias,
          entryTitle: c.entry_title,
          mcpNamespace: c.mcp_namespace,
        })),
      };
    } catch (cause) {
      logger.warn({ url, bundleId, cause }, "Deployment bootstrap request failed");
      return null;
    }
  }
}
