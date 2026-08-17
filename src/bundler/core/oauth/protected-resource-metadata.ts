import { bundleResourceUri, keycloakIssuerUrl } from "./resource-identifiers.js";

/**
 * RFC 9728 OAuth 2.0 Protected Resource Metadata, scoped to one bundle.
 * Minimal by design - just enough for a spec-compliant MCP client to learn
 * which resource it's authorizing for and which Authorization Server to
 * redirect to. The bundler never appears in this document as anything
 * other than the resource; it is never itself an Authorization Server.
 */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
}

export function buildProtectedResourceMetadata(bundleId: string): ProtectedResourceMetadata {
  return {
    resource: bundleResourceUri(bundleId),
    authorization_servers: [keycloakIssuerUrl()],
    bearer_methods_supported: ["header"],
  };
}
