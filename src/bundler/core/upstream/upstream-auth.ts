import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformationMixed
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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

export function buildAuthOptions(
  config?: MCPAuthConfig,
  configOverrides?: Record<string, string>
): StreamableHTTPClientTransportOptions {
  const configHeaders: Record<string, string> = {};
  if (configOverrides) {
    for (const [key, value] of Object.entries(configOverrides)) {
      configHeaders[`X-Mcp-Config-${key}`] = value;
    }
  }

  if (!config || config.method === "none") {
    return Object.keys(configHeaders).length > 0
      ? { requestInit: { headers: configHeaders } }
      : {};
  }

  let authHeaders: Record<string, string> = {};

  switch (config.method) {
    case "bearer":
      authHeaders = { "Authorization": `Bearer ${config.token}` };
      break;

    case "basic": {
      const credentials = Buffer.from(`${config.username}:${config.password}`).toString("base64");
      authHeaders = { "Authorization": `Basic ${credentials}` };
      break;
    }

    case "api_key":
      authHeaders = { [config.header]: config.key };
      break;

    case "headers":
      authHeaders = config.headers;
      break;

    default:
      break;
  }

  return {
    requestInit: {
      headers: { ...authHeaders, ...configHeaders },
    },
  };
}
