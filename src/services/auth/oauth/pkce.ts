/**
 * PKCE (Proof Key for Code Exchange) Utilities
 *
 * Implements RFC 7636 for secure OAuth authorization
 */

import { createHash, randomBytes } from 'crypto';

export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
}

/**
 * Generate a random code verifier
 * RFC 7636: 43-128 characters from [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 */
function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Generate code challenge from verifier using SHA256
 */
function generateCodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

/**
 * Generate PKCE challenge pair
 */
export function generatePKCE(): PKCEChallenge {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: 'S256',
  };
}

/**
 * Validate PKCE code verifier
 */
export function validatePKCE(codeVerifier: string, codeChallenge: string): boolean {
  const expectedChallenge = generateCodeChallenge(codeVerifier);
  return expectedChallenge === codeChallenge;
}
