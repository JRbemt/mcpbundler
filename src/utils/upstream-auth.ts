import { UpstreamAuthConfig } from '../core/config/schemas.js';
import https from 'https';

export interface AuthHeaders {
  [key: string]: string;
}

export interface AuthTransportOptions {
  headers?: AuthHeaders;
  httpsAgent?: https.Agent;
}

/**
 * Converts upstream auth config to HTTP headers/options for SSEClientTransport
 *
 * @param auth - Optional auth configuration
 * @returns Object with headers and/or httpsAgent for transport
 */
export function buildAuthOptions(auth?: UpstreamAuthConfig): AuthTransportOptions {
  if (!auth || auth.method === 'none') {
    return {};
  }

  switch (auth.method) {
    case 'bearer':
      return {
        headers: {
          'Authorization': `Bearer ${auth.token}`
        }
      };

    case 'basic':
      const basicCreds = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return {
        headers: {
          'Authorization': `Basic ${basicCreds}`
        }
      };

    case 'api_key':
      return {
        headers: {
          [auth.header]: auth.key
        }
      };

    case 'oauth2':
      // Check token expiry
      if (auth.expires_at && Date.now() / 1000 > auth.expires_at) {
        throw new Error('OAuth2 token expired');
        // TODO: Implement token refresh logic
      }
      return {
        headers: {
          'Authorization': `Bearer ${auth.access_token}`
        }
      };

    case 'mtls':
      return {
        httpsAgent: new https.Agent({
          cert: auth.client_cert,
          key: auth.client_key,
          ca: auth.ca_cert,
          rejectUnauthorized: true,
        })
      };

    default:
      // TypeScript exhaustiveness check
      throw new Error(`Unsupported auth method: ${(auth as any).method}`);
  }
}
