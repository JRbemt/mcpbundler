import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformationMixed
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import logger from "../../../shared/utils/logger.js";
import { MCPAuthConfig } from "../../../shared/domain/entities.js";

export class UpstreamOAuthProvider implements OAuthClientProvider {
  private _tokens?: OAuthTokens;
  private _clientInfo?: OAuthClientInformationMixed;
  private _codeVerifier?: string;

  constructor(
    private config: {
      clientId: string;
      redirectUrl: string;
      scopes?: string[];
    }
  ) { }

  get redirectUrl(): string {
    return this.config.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "MCP Bundler",
      redirect_uris: [this.config.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post"
    };
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this._clientInfo;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this._clientInfo = info;
  }

  tokens(): OAuthTokens | undefined {
    return this._tokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this._tokens = tokens;
  }

  redirectToAuthorization(url: URL): void {
    console.log(`Authorization required for upstream: ${url.toString()}`);
  }

  saveCodeVerifier(verifier: string): void {
    this._codeVerifier = verifier;
  }

  codeVerifier(): string {
    if (!this._codeVerifier) {
      throw new Error("No code verifier saved");
    }
    return this._codeVerifier;
  }
}

export function buildAuthOptions(config?: MCPAuthConfig): StreamableHTTPClientTransportOptions {
  if (!config || config.method === "none") {
    return {};
  }

  switch (config.method) {
    case "bearer":
      return {
        requestInit: {
          headers: {
            "Authorization": `Bearer ${config.token}`
          }
        }
      };

    case "basic": {
      const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64");
      return {
        requestInit: {
          headers: {
            "Authorization": `Basic ${credentials}`
          }
        }
      };
    }

    case "api_key":
      return {
        requestInit: {
          headers: {
            [config.header]: config.key
          }
        }
      };

    default:
      return {};
  }
}
