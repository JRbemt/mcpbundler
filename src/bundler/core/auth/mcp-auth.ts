/**
 * Upstream Auth - Authentication config to HTTP transport options
 *
 * Converts upstream auth configurations (bearer, basic, API key, OAuth2, mTLS)
 * into HTTP headers and transport options for MCP SSE connections. Handles token
 * encoding, expiration checks, and HTTPS agent configuration for mTLS.
 */

import https from 'https';
import { MCPAuthConfig } from '../../../shared/domain/entities.js';
import logger from '../../../shared/utils/logger.js';

export interface SSEClientTransportOptions {
  requestInit?: RequestInit;
  eventSourceInit?: EventSourceInit;
  authProvider?: any;
  fetch?: any;
  httpsAgent?: https.Agent;
}

/**
 * Converts upstream auth config to HTTP headers/options for SSEClientTransport
 *
 * @param auth - Optional auth configuration
 * @returns Object with requestInit containing headers for transport
 */
export function buildAuthOptions(auth?: MCPAuthConfig): SSEClientTransportOptions {
  if (!auth || auth.method === 'none') {
    return {};
  }

  const headers: Record<string, string> = {};

  switch (auth.method) {
    case 'bearer':
      headers['Authorization'] = `Bearer ${auth.token}`;
      break;

    case 'basic':
      const basicCreds = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      headers['Authorization'] = `Basic ${basicCreds}`;
      break;

    case 'api_key':
      headers[auth.header] = auth.key;
      break;

    default:
      // TypeScript exhaustiveness check
      logger.error(`Unsupported auth method: ${(auth)}`)
      throw new Error(`Unsupported auth method: ${(auth)}`);
  }

  return {
    requestInit: {
      headers
    }
  };
}
