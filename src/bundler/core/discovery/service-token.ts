// Server-only client_credentials token for the anonymous MCP discovery
// session - mirrors mcp-market/src/lib/auth/service-token.ts, which solves
// the identical problem (signed-out marketplace browsing) against the same
// backend discover endpoints. Deliberately configured with the SAME
// Keycloak client credentials as mcp-market's MARKETPLACE_ANON_KEYCLOAK_*
// (a separate BUNDLER_ANON_KEYCLOAK_CLIENT_ID/SECRET pair here would mint
// a service token the backend's get_security_context has never heard of -
// it only special-cases one recognized anon client id, and an unrecognized
// client_credentials token falls through to normal user auth and
// JIT-provisions a real, privileged User row from what is supposed to be a
// machine-only credential). Two env vars because this runs in a different
// service with its own process/credential lifecycle, not because the
// underlying Keycloak client is meant to differ.

import logger from "../../../shared/utils/logger.js";

const EXPIRY_SAFETY_MARGIN_SECONDS = 30;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
let inFlight: Promise<string | null> | null = null;

function tokenEndpoint(): string {
  const serverUrl = process.env.KEYCLOAK_SERVER_URL ?? "";
  const realm = process.env.KEYCLOAK_REALM ?? "";
  return `${serverUrl.replace(/\/$/, "")}/realms/${realm}/protocol/openid-connect/token`;
}

function isConfigured(): boolean {
  return Boolean(
    process.env.KEYCLOAK_SERVER_URL &&
    process.env.KEYCLOAK_REALM &&
    process.env.BUNDLER_ANON_KEYCLOAK_CLIENT_ID &&
    process.env.BUNDLER_ANON_KEYCLOAK_CLIENT_SECRET
  );
}

async function fetchToken(): Promise<string | null> {
  const endpoint = tokenEndpoint();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.BUNDLER_ANON_KEYCLOAK_CLIENT_ID ?? "",
        client_secret: process.env.BUNDLER_ANON_KEYCLOAK_CLIENT_SECRET ?? "",
      }),
    });
  } catch (cause) {
    logger.warn({ endpoint, cause }, "Anonymous service token request failed");
    return null;
  }

  if (!response.ok) {
    logger.warn({ endpoint, status: response.status }, "Anonymous service token request failed");
    return null;
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  const ttlSeconds = data.expires_in ?? 60;
  cached = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (ttlSeconds - EXPIRY_SAFETY_MARGIN_SECONDS) * 1000,
  };
  return cached.accessToken;
}

/**
 * Returns a cached or freshly-fetched anonymous-browsing access token, or
 * null if the anon client isn't configured, the token request fails (network
 * error or non-2xx response), or the response doesn't carry an access token -
 * callers should treat null as "send no token" rather than throw.
 */
export async function getServiceToken(): Promise<string | null> {
  if (!isConfigured()) return null;

  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken;
  }

  if (!inFlight) {
    inFlight = fetchToken().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
