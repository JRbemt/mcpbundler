// Builds the identifiers the OAuth 2.1 discovery flow needs to point a
// spec-compliant client at Keycloak for one specific bundle - RFC 8707
// (Resource Indicators) for the resource URI itself, RFC 9728 (Protected
// Resource Metadata) for where its metadata document lives. None of this
// affects post-auth MCP traffic, which always goes through the shared
// /mcp endpoint regardless of which resource URI triggered authorization.

import logger from "../../../shared/utils/logger.js";

// Logged at most once per process: every request that reaches these
// builders while BUNDLER_PUBLIC_URL is unset would otherwise repeat the
// same warning, drowning out everything else in the log stream without
// adding new information after the first occurrence.
let warnedAboutMissingPublicUrl = false;

function publicBaseUrl(): string {
  const configured = (process.env.BUNDLER_PUBLIC_URL ?? "").replace(/\/$/, "");
  if (!configured && process.env.BUNDLER_NATIVE_OAUTH_ENABLED === "true" && !warnedAboutMissingPublicUrl) {
    warnedAboutMissingPublicUrl = true;
    logger.warn(
      "BUNDLER_PUBLIC_URL is unset while BUNDLER_NATIVE_OAUTH_ENABLED=true - " +
      "resource and Protected Resource Metadata URLs will be relative, which " +
      "is spec-invalid per RFC 9728/6750 (both require absolute URIs). Set " +
      "BUNDLER_PUBLIC_URL to this bundler's externally reachable base URL."
    );
  }
  return configured;
}

/**
 * The RFC 8707 resource identifier for a single bundle - what a
 * spec-compliant MCP client is configured to connect to, and what carries
 * through the authorization-code and token requests as the `resource`
 * parameter.
 */
export function bundleResourceUri(bundleId: string): string {
  return `${publicBaseUrl()}/mcp/${encodeURIComponent(bundleId)}`;
}

/**
 * The RFC 9728 well-known metadata document URL for a bundle's resource
 * URI. Per RFC 9728 section 3.1 (mirroring RFC 8414's path-insertion
 * rule for AS metadata), the well-known path component is inserted
 * between the resource URI's authority and its path - not appended after
 * the full resource URI.
 */
export function protectedResourceMetadataUrl(bundleId: string): string {
  return `${publicBaseUrl()}/.well-known/oauth-protected-resource/mcp/${encodeURIComponent(bundleId)}`;
}

/**
 * Keycloak's OIDC/OAuth issuer URL for the realm the bundler authenticates
 * against - the only entry in a bundle's `authorization_servers` list,
 * since Keycloak is the sole Authorization Server this design uses.
 */
export function keycloakIssuerUrl(): string {
  const serverUrl = (process.env.KEYCLOAK_SERVER_URL ?? "").replace(/\/$/, "");
  const realm = process.env.KEYCLOAK_REALM ?? "";
  return `${serverUrl}/realms/${realm}`;
}
