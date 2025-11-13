/**
 * Simple Bearer Token Auth Provider for MCP SDK
 * 
 * This provides a minimal implementation of OAuthClientProvider
 * that just returns a static bearer token for authentication.
 */

import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthClientMetadata, OAuthClientInformation, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

export class BearerTokenAuthProvider implements OAuthClientProvider {
    constructor(private readonly token: string) { }

    get redirectUrl(): string {
        return '';
    }

    get clientMetadata(): OAuthClientMetadata {
        return {
            redirect_uris: []
        };
    }

    clientInformation(): OAuthClientInformation | undefined {
        return undefined;
    }

    async tokens(): Promise<OAuthTokens> {
        return {
            access_token: this.token,
            token_type: 'Bearer'
        };
    }

    async saveTokens(tokens: OAuthTokens): Promise<void> {
        // Not needed for static bearer tokens
    }

    async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
        // Not needed for static bearer tokens
        throw new Error('Redirect not supported for bearer token auth');
    }

    async saveCodeVerifier(codeVerifier: string): Promise<void> {
        // Not needed for static bearer tokens
    }

    async codeVerifier(): Promise<string> {
        // Not needed for static bearer tokens
        return '';
    }
}