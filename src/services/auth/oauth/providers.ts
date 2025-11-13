/**
 * OAuth Provider Registry
 *
 * Configuration for supported OAuth providers
 */

export interface OAuthProviderConfig {
  name: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  supportsRefresh: boolean;
}

export const OAuthProviders: Record<string, OAuthProviderConfig> = {
  github: {
    name: 'GitHub',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    scopes: ['repo', 'user'],
    supportsRefresh: false,
  },

  google: {
    name: 'Google',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    scopes: ['openid', 'email', 'profile'],
    supportsRefresh: true,
  },

  notion: {
    name: 'Notion',
    authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    clientId: process.env.NOTION_CLIENT_ID || '',
    clientSecret: process.env.NOTION_CLIENT_SECRET || '',
    scopes: [],
    supportsRefresh: false,
  },

  slack: {
    name: 'Slack',
    authorizationUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientId: process.env.SLACK_CLIENT_ID || '',
    clientSecret: process.env.SLACK_CLIENT_SECRET || '',
    scopes: ['channels:read', 'chat:write'],
    supportsRefresh: true,
  },
};

/**
 * Get OAuth provider configuration
 */
export function getOAuthProvider(provider: string): OAuthProviderConfig | null {
  return OAuthProviders[provider] || null;
}

/**
 * Get all configured OAuth providers
 */
export function getConfiguredProviders(): string[] {
  return Object.keys(OAuthProviders).filter(
    (key) => OAuthProviders[key].clientId && OAuthProviders[key].clientSecret
  );
}

/**
 * Check if provider is configured
 */
export function isProviderConfigured(provider: string): boolean {
  const config = getOAuthProvider(provider);
  return config !== null && !!config.clientId && !!config.clientSecret;
}
