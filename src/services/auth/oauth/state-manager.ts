/**
 * OAuth State Manager
 *
 * Manages OAuth flow state with automatic expiration
 */

import { randomBytes } from 'crypto';

export interface OAuthState {
  state: string;
  codeVerifier: string;
  provider: string;
  tokenOrId: string;
  upstreamNamespace?: string;
  createdAt: number;
  expiresAt: number;
}

export class OAuthStateManager {
  private states: Map<string, OAuthState> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private ttlMs: number = 10 * 60 * 1000) {
    // 10 minutes default
    // Cleanup expired states every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Generate a new OAuth state
   */
  create(
    provider: string,
    tokenOrId: string,
    codeVerifier: string,
    upstreamNamespace?: string
  ): string {
    const state = randomBytes(32).toString('hex');
    const now = Date.now();

    this.states.set(state, {
      state,
      codeVerifier,
      provider,
      tokenOrId,
      upstreamNamespace,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    });

    return state;
  }

  /**
   * Get OAuth state by state string
   */
  get(state: string): OAuthState | null {
    const oauthState = this.states.get(state);

    if (!oauthState) {
      return null;
    }

    // Check expiration
    if (Date.now() > oauthState.expiresAt) {
      this.states.delete(state);
      return null;
    }

    return oauthState;
  }

  /**
   * Delete OAuth state
   */
  delete(state: string): void {
    this.states.delete(state);
  }

  /**
   * Cleanup expired states
   */
  private cleanup(): void {
    const now = Date.now();

    for (const [state, oauthState] of this.states.entries()) {
      if (now > oauthState.expiresAt) {
        this.states.delete(state);
      }
    }
  }

  /**
   * Get all active states for a token
   */
  getByToken(tokenOrId: string): OAuthState[] {
    const result: OAuthState[] = [];
    const now = Date.now();

    for (const oauthState of this.states.values()) {
      if (oauthState.tokenOrId === tokenOrId && now <= oauthState.expiresAt) {
        result.push(oauthState);
      }
    }

    return result;
  }

  /**
   * Destroy the state manager
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.states.clear();
  }
}

// Singleton instance
let instance: OAuthStateManager | null = null;

export function getOAuthStateManager(): OAuthStateManager {
  if (!instance) {
    instance = new OAuthStateManager();
  }
  return instance;
}
