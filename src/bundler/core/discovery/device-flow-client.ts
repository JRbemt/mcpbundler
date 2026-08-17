// Server-to-server RFC 8628 Device Authorization Grant client. The bundler
// itself is the OAuth client here - not the agent, not a browser the agent
// controls - so it can drive the flow on behalf of any MCP client, including
// ones with no OAuth support at all. Deliberately a separate Keycloak client
// registration from BUNDLER_ANON_KEYCLOAK_CLIENT_ID (service-token.ts):
// that one uses client_credentials to authenticate the bundler itself for
// read-only catalog calls; this one uses the device_code grant to
// authenticate a human, via a browser they visit separately from the agent
// session that requested the connection.

import logger from "../../../shared/utils/logger.js";

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export type DeviceTokenPollResult =
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; accessToken: string };

function isConfigured(): boolean {
  return Boolean(
    process.env.KEYCLOAK_SERVER_URL &&
    process.env.KEYCLOAK_REALM &&
    process.env.BUNDLER_DEVICEFLOW_KEYCLOAK_CLIENT_ID &&
    process.env.BUNDLER_DEVICEFLOW_KEYCLOAK_CLIENT_SECRET
  );
}

function realmBase(): string {
  const serverUrl = process.env.KEYCLOAK_SERVER_URL ?? "";
  const realm = process.env.KEYCLOAK_REALM ?? "";
  return `${serverUrl.replace(/\/$/, "")}/realms/${realm}`;
}

function deviceAuthorizationEndpoint(): string {
  return `${realmBase()}/protocol/openid-connect/auth/device`;
}

function tokenEndpoint(): string {
  return `${realmBase()}/protocol/openid-connect/token`;
}

function clientCredentialsBody(extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    client_id: process.env.BUNDLER_DEVICEFLOW_KEYCLOAK_CLIENT_ID ?? "",
    client_secret: process.env.BUNDLER_DEVICEFLOW_KEYCLOAK_CLIENT_SECRET ?? "",
    ...extra,
  });
}

/**
 * Requests a fresh device code from Keycloak. Returns null if the
 * device-flow client isn't configured or the request fails - callers treat
 * null as "device flow unavailable right now" rather than a thrown error.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse | null> {
  if (!isConfigured()) return null;

  const endpoint = deviceAuthorizationEndpoint();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: clientCredentialsBody(),
    });
  } catch (cause) {
    logger.warn({ endpoint, cause }, "Device code request failed");
    return null;
  }

  if (!response.ok) {
    logger.warn({ endpoint, status: response.status }, "Device code request failed");
    return null;
  }

  const data = (await response.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    verification_uri_complete?: string;
    expires_in?: number;
    interval?: number;
  };

  if (!data.device_code || !data.user_code || !data.verification_uri) {
    logger.warn({ endpoint }, "Device code response missing required fields");
    return null;
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresInSeconds: data.expires_in ?? 600,
    intervalSeconds: data.interval ?? 5,
  };
}

/**
 * Polls Keycloak's token endpoint for the device_code grant per RFC 8628
 * section 3.5. Every documented outcome maps to a distinct status so
 * connection-tools.ts can decide what to tell the agent without re-deriving
 * RFC error-code semantics itself. A network failure is treated the same as
 * "authorization_pending" - the agent just polls again - rather than
 * surfaced as a hard failure, since it is very likely transient.
 */
export async function pollDeviceToken(deviceCode: string): Promise<DeviceTokenPollResult> {
  const endpoint = tokenEndpoint();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: clientCredentialsBody({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
      }),
    });
  } catch (cause) {
    logger.warn({ endpoint, cause }, "Device token poll request failed");
    return { status: "pending" };
  }

  const data = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };

  if (response.ok && typeof data.access_token === "string") {
    return { status: "approved", accessToken: data.access_token };
  }

  switch (data.error) {
    case "slow_down":
      return { status: "slow_down" };
    case "access_denied":
      return { status: "denied" };
    case "expired_token":
      return { status: "expired" };
    case "authorization_pending":
    default:
      return { status: "pending" };
  }
}
