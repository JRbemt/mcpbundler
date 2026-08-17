const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * True when `token` is structurally a JWT - three non-empty base64url
 * segments separated by dots. This is a format check only, never a
 * cryptographic one: the bundler must never validate a Keycloak JWT
 * itself (that is the backend deployment bootstrap endpoint's job). The
 * only decision this makes is "does this need to be handed to the backend
 * for exchange," as opposed to being one of the bundler's own opaque
 * bundle tokens (hex, no dots).
 */
export function looksLikeKeycloakJwt(token: string): boolean {
  const segments = token.split(".");
  return segments.length === 3 && segments.every((segment) => BASE64URL_SEGMENT.test(segment));
}
