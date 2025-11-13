/**
 * OAuth Service
 *
 * Handles OAuth 2.1 authorization flows with PKCE (Proof Key for Code Exchange)
 * for secure authentication with external OAuth providers.
 *
 * ## OAuth 2.1 Flow Overview
 *
 * 1. **Authorization Request**: Generate PKCE challenge, create state token, redirect user to provider
 * 2. **User Authorization**: User authenticates and grants permissions at provider
 * 3. **Callback**: Provider redirects back with authorization code and state
 * 4. **Token Exchange**: Exchange code + PKCE verifier for access/refresh tokens
 * 5. **Storage**: Encrypt and store tokens in database, update upstream config
 *
 * ## Security Features
 *
 * - **PKCE**: Prevents authorization code interception attacks
 * - **State Validation**: Prevents CSRF attacks via random state tokens
 * - **Token Encryption**: OAuth tokens are encrypted at rest using AES-256-GCM
 * - **Auto-expiration**: State tokens expire after 10 minutes
 * - **Secure Random**: Uses crypto.randomBytes for all random generation
 *
 * ## Usage Example
 *
 * ```typescript
 * const oauthService = new OAuthService(publicUrl, oauthTokenRepo, mcpRepo);
 *
 * // Start authorization flow
 * const { authorizationUrl } = await oauthService.startAuthorization(
 *   'github',
 *   'col_123',
 *   'mcp-github'
 * );
 * // Redirect user to authorizationUrl
 *
 * // Handle callback
 * const tokens = await oauthService.handleCallback(
 *   'github',
 *   code,
 *   state
 * );
 * ```
 *
 * ## Architecture Notes
 *
 * - Uses singleton OAuthStateManager for in-memory state storage
 * - Repositories handle encrypted credential persistence
 * - Supports token refresh for providers that offer refresh tokens
 * - Thread-safe for concurrent authorization flows
 */

import axios from 'axios';
import { getOAuthProvider, OAuthProviderConfig } from './providers.js';
import { generatePKCE } from './pkce.js';
import { getOAuthStateManager } from './state-manager.js';
import { OAuthTokenRepository } from '../../api/database/repositories/OAuthTokenRepository.js';
import { McpRepository } from '../../api/database/repositories/McpRepository.js';
import { McpCredentialRepository } from '../../api/database/repositories/McpCredentialRepository.js';
import logger from '../../utils/logger.js';

/**
 * Result of initiating an OAuth authorization flow
 */
export interface AuthorizationURLResult {
  /** The URL to redirect the user to for authorization */
  authorizationUrl: string;
  /** The state token for CSRF protection (stored in state manager) */
  state: string;
}

/**
 * Result of exchanging an authorization code for tokens
 */
export interface TokenExchangeResult {
  /** OAuth access token for API requests */
  accessToken: string;
  /** Optional refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Token lifetime in seconds (if provided by OAuth provider) */
  expiresIn?: number;
}

export class OAuthService {
  private stateManager = getOAuthStateManager();
  private oauthTokenRepo: OAuthTokenRepository;
  private mcpRepo: McpRepository;
  private mcpCredRepo: McpCredentialRepository;
  private publicUrl: string;

  constructor(
    publicUrl: string,
    oauthTokenRepo: OAuthTokenRepository,
    mcpRepo: McpRepository,
    mcpCredRepo: McpCredentialRepository
  ) {
    this.publicUrl = publicUrl;
    this.oauthTokenRepo = oauthTokenRepo;
    this.mcpRepo = mcpRepo;
    this.mcpCredRepo = mcpCredRepo;
  }

  /**
   * Start OAuth 2.1 authorization flow with PKCE
   *
   * Initiates an OAuth authorization flow by:
   * 1. Generating a PKCE code challenge (SHA-256 hash of random verifier)
   * 2. Creating a cryptographically secure state token
   * 3. Storing the state and code verifier in memory (expires in 10 minutes)
   * 4. Building the authorization URL with all required OAuth parameters
   *
   * The user should be redirected to the returned authorizationUrl.
   * The OAuth provider will redirect back to the configured callback URL
   * with an authorization code and the same state token.
   *
   * @param provider - OAuth provider name (e.g., 'github', 'google')
   *                   Must be configured in providers.ts with clientId/clientSecret
   * @param tokenOrId - Collection token (mcpb_live_...) or token ID
   * @param upstreamNamespace - Namespace of the specific MCP to authorize
   *
   * @returns Authorization URL to redirect user to, and state token for validation
   *
   * @throws Error if provider is unknown or not configured with credentials
   *
   * @example
   * ```typescript
   * const result = await oauthService.startAuthorization('github', 'mcpb_live_abc...', 'mcp-github');
   * // Redirect user to result.authorizationUrl
   * res.redirect(result.authorizationUrl);
   * ```
   *
   * @security
   * - State token prevents CSRF attacks
   * - PKCE prevents authorization code interception
   * - State expires after 10 minutes to prevent replay attacks
   */
  async startAuthorization(
    provider: string,
    tokenOrId: string,
    upstreamNamespace: string
  ): Promise<AuthorizationURLResult> {
    const providerConfig = getOAuthProvider(provider);

    if (!providerConfig) {
      throw new Error(`Unknown OAuth provider: ${provider}`);
    }

    if (!providerConfig.clientId || !providerConfig.clientSecret) {
      throw new Error(`OAuth provider ${provider} not configured`);
    }

    // Generate PKCE challenge for enhanced security
    // - codeVerifier: Random 43-128 character string stored in state
    // - codeChallenge: SHA-256 hash of verifier sent to provider
    // - codeChallengeMethod: 'S256' indicates SHA-256 hashing
    const pkce = generatePKCE();

    // Create cryptographically secure state token
    // Stores: provider, tokenOrId, codeVerifier, upstreamNamespace
    // Expires: 10 minutes (prevents replay attacks)
    const state = this.stateManager.create(
      provider,
      tokenOrId,
      pkce.codeVerifier,
      upstreamNamespace
    );

    // Build OAuth 2.1 authorization URL with PKCE parameters
    const authUrl = new URL(providerConfig.authorizationUrl);
    authUrl.searchParams.set('client_id', providerConfig.clientId);
    authUrl.searchParams.set(
      'redirect_uri',
      `${this.publicUrl}/api/oauth/callback/${provider}`
    );
    authUrl.searchParams.set('response_type', 'code'); // Request authorization code
    authUrl.searchParams.set('state', state); // CSRF protection
    authUrl.searchParams.set('code_challenge', pkce.codeChallenge); // PKCE challenge
    authUrl.searchParams.set('code_challenge_method', pkce.codeChallengeMethod); // 'S256'

    // Add scopes if provider requires specific permissions
    if (providerConfig.scopes.length > 0) {
      authUrl.searchParams.set('scope', providerConfig.scopes.join(' '));
    }

    logger.info(
      {
        provider,
        tokenOrId,
        upstreamNamespace,
      },
      'Started OAuth authorization flow'
    );

    return {
      authorizationUrl: authUrl.toString(),
      state,
    };
  }

  /**
   * Handle OAuth callback and exchange authorization code for access tokens
   *
   * Called when the OAuth provider redirects back to your callback URL.
   * This method:
   * 1. Validates the state token (CSRF protection)
   * 2. Retrieves the stored PKCE code verifier
   * 3. Exchanges the authorization code + verifier for tokens
   * 4. Encrypts and stores the tokens in the database
   * 5. Updates the upstream config with auth credentials
   * 6. Cleans up the temporary state
   *
   * @param provider - OAuth provider name (must match the one from startAuthorization)
   * @param code - Authorization code returned by the OAuth provider
   * @param state - State token returned by the OAuth provider (for CSRF validation)
   *
   * @returns Access token, optional refresh token, and expiration time
   *
   * @throws Error if state is invalid/expired, provider mismatch, or token exchange fails
   *
   * @example
   * ```typescript
   * // In your callback route handler
   * app.get('/oauth/callback/:provider', async (req, res) => {
   *   const { code, state } = req.query;
   *   const tokens = await oauthService.handleCallback(
   *     req.params.provider,
   *     code as string,
   *     state as string
   *   );
   *   res.send('Authorization successful!');
   * });
   * ```
   *
   * @security
   * - State validation prevents CSRF attacks
   * - PKCE verifier proves authorization code wasn't intercepted
   * - Tokens are encrypted with AES-256-GCM before storage
   * - State is immediately deleted after use (single-use token)
   */
  async handleCallback(
    provider: string,
    code: string,
    state: string
  ): Promise<TokenExchangeResult> {
    // Validate state token to prevent CSRF attacks
    // This ensures the callback is for an authorization we initiated
    const oauthState = this.stateManager.get(state);

    if (!oauthState) {
      // State not found or expired (10 minute TTL)
      throw new Error('Invalid or expired OAuth state');
    }

    if (oauthState.provider !== provider) {
      // Provider in callback URL doesn't match provider in state
      // This could indicate a CSRF attack or URL manipulation
      throw new Error('Provider mismatch');
    }

    const providerConfig = getOAuthProvider(provider);

    if (!providerConfig) {
      throw new Error(`Unknown OAuth provider: ${provider}`);
    }

    try {
      // Exchange authorization code + PKCE verifier for access/refresh tokens
      // The PKCE verifier proves we're the same client that initiated the flow
      const tokenResponse = await this.exchangeCodeForTokens(
        providerConfig,
        code,
        oauthState.codeVerifier
      );

      // Store encrypted credentials for the MCP
      await this.storeCredentials(
        oauthState.tokenOrId,
        oauthState.upstreamNamespace,
        provider,
        tokenResponse
      );

      // Clean up state immediately (single-use token)
      // This prevents the callback URL from being replayed
      this.stateManager.delete(state);

      logger.info(
        {
          provider,
          tokenOrId: oauthState.tokenOrId,
          upstreamNamespace: oauthState.upstreamNamespace,
        },
        'OAuth authorization completed successfully'
      );

      return tokenResponse;
    } catch (error: any) {
      logger.error(
        {
          provider,
          error: error.message,
        },
        'OAuth token exchange failed'
      );
      throw error;
    }
  }

  /**
   * Exchange authorization code for access token (private helper)
   *
   * Makes a direct HTTP POST to the OAuth provider's token endpoint
   * with the authorization code and PKCE verifier.
   *
   * @param providerConfig - OAuth provider configuration (URLs, credentials, etc.)
   * @param code - Authorization code from provider callback
   * @param codeVerifier - PKCE code verifier (proves we initiated the flow)
   *
   * @returns Tokens and expiration from OAuth provider
   *
   * @throws Error if token exchange fails (network error, invalid code, etc.)
   *
   * @internal This is called by handleCallback() and refreshToken()
   */
  private async exchangeCodeForTokens(
    providerConfig: OAuthProviderConfig,
    code: string,
    codeVerifier: string
  ): Promise<TokenExchangeResult> {
    const response = await axios.post(
      providerConfig.tokenUrl,
      {
        client_id: providerConfig.clientId,
        client_secret: providerConfig.clientSecret,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: `${this.publicUrl}/api/oauth/callback/${providerConfig.name.toLowerCase()}`,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
    };
  }

  /**
   * Store OAuth credentials in database (private helper)
   *
   * Performs two database operations:
   * 1. Creates/finds token-specific MCP credential record
   * 2. Stores encrypted OAuth tokens in oauth_credentials table
   *
   * Tokens are encrypted using AES-256-GCM before storage.
   *
   * @param tokenOrId - Collection token (mcpb_live_...) or token ID
   * @param upstreamNamespace - Namespace of the MCP to authorize
   * @param provider - OAuth provider name
   * @param tokens - Access token, refresh token, and expiration
   *
   * @throws Error if MCP not found or database operation fails
   *
   * @internal Called by handleCallback() after successful token exchange
   */
  private async storeCredentials(
    tokenOrId: string,
    upstreamNamespace: string,
    provider: string,
    tokens: TokenExchangeResult
  ): Promise<void> {
    // Calculate absolute expiration timestamp from relative expiresIn
    // expiresIn is in seconds, convert to milliseconds and add to current time
    const expiresAt = tokens.expiresIn
      ? new Date(Date.now() + tokens.expiresIn * 1000)
      : undefined;

    // Create or find token-specific MCP credential
    let mcpCredential = await this.mcpCredRepo.findByTokenAndMcp(
      tokenOrId,
      upstreamNamespace
    );

    if (!mcpCredential) {
      // Create new token-specific credential with OAuth config
      mcpCredential = await this.mcpCredRepo.bind(
        tokenOrId,
        upstreamNamespace,
        {
          method: 'oauth2',
          provider,
        }
      );
    }

    // Store encrypted OAuth tokens
    // Tokens are encrypted with AES-256-GCM using OAUTH_ENCRYPTION_KEY
    await this.oauthTokenRepo.store(
      mcpCredential.id,
      provider,
      tokens.accessToken,
      tokens.refreshToken,
      expiresAt
    );
  }

  /**
   * Refresh an expired OAuth access token using a refresh token
   *
   * When an access token expires, this method obtains a new access token
   * using the stored refresh token (if the provider supports it).
   *
   * The new tokens are automatically stored in the database, replacing
   * the old credentials.
   *
   * @param tokenMcpCredentialId - ID of the token-specific MCP credential
   * @param provider - OAuth provider name (must support refresh tokens)
   *
   * @returns New access token, possibly new refresh token, and expiration
   *
   * @throws Error if:
   *   - Provider doesn't support token refresh
   *   - No refresh token is available
   *   - Token refresh request fails (invalid/revoked refresh token)
   *
   * @example
   * ```typescript
   * try {
   *   const newTokens = await oauthService.refreshToken(
   *     'credential_123',
   *     'google'
   *   );
   *   console.log('Token refreshed, expires in:', newTokens.expiresIn);
   * } catch (error) {
   *   // Refresh failed - user needs to re-authorize
   *   console.error('Re-authorization required');
   * }
   * ```
   *
   * @remarks
   * Some OAuth providers rotate refresh tokens on each refresh.
   * The new refresh token (if provided) will replace the old one.
   */
  async refreshToken(
    tokenMcpCredentialId: string,
    provider: string
  ): Promise<TokenExchangeResult> {
    const providerConfig = getOAuthProvider(provider);

    if (!providerConfig || !providerConfig.supportsRefresh) {
      throw new Error(`Provider ${provider} does not support token refresh`);
    }

    const refreshToken = await this.oauthTokenRepo.getRefreshToken(tokenMcpCredentialId, provider);

    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await axios.post(
      providerConfig.tokenUrl,
      {
        client_id: providerConfig.clientId,
        client_secret: providerConfig.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      }
    );

    const expiresAt = response.data.expires_in
      ? new Date(Date.now() + response.data.expires_in * 1000)
      : undefined;

    // Update stored credentials
    await this.oauthTokenRepo.store(
      tokenMcpCredentialId,
      provider,
      response.data.access_token,
      response.data.refresh_token || refreshToken,
      expiresAt
    );

    logger.info({ tokenMcpCredentialId, provider }, 'OAuth token refreshed successfully');

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
    };
  }
}
