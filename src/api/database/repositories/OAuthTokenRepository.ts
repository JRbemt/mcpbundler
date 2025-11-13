import { PrismaClient, OAuthCredential } from '@prisma/client';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

// Encryption utilities for OAuth tokens
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Get encryption key from environment or generate
 */
function getEncryptionKey(): Buffer {
  const key = process.env.OAUTH_ENCRYPTION_KEY;
  if (!key) {
    console.warn('Warning: OAUTH_ENCRYPTION_KEY not set. Using default key. This is insecure for production!');
    return createHash('sha256').update('default-key-please-change').digest();
  }
  return createHash('sha256').update(key).digest();
}

/**
 * Encrypt a token
 */
export function encryptToken(token: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);

  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a token
 */
export function decryptToken(encryptedToken: string): string {
  const [ivHex, authTagHex, encrypted] = encryptedToken.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Repository for managing OAuth access/refresh tokens
 * Handles encrypted storage and retrieval of OAuth tokens for MCPs
 */
export class OAuthTokenRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Store OAuth credentials for a token MCP credential
   */
  async store(
    tokenMcpCredentialId: string,
    provider: string,
    accessToken: string,
    refreshToken?: string,
    expiresAt?: Date
  ): Promise<OAuthCredential> {
    // Encrypt tokens
    const encryptedAccessToken = encryptToken(accessToken);
    const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : null;

    // Find existing credential for this tokenMcpCredential+provider
    const existing = await this.prisma.oAuthCredential.findFirst({
      where: {
        tokenMcpCredentialId,
        provider,
      },
    });

    if (existing) {
      // Update existing
      return await this.prisma.oAuthCredential.update({
        where: { id: existing.id },
        data: {
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt,
        },
      });
    } else {
      // Create new
      return await this.prisma.oAuthCredential.create({
        data: {
          tokenMcpCredentialId,
          provider,
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt,
        },
      });
    }
  }

  /**
   * Find OAuth credentials by token MCP credential and provider
   */
  async findByTokenMcpCredentialAndProvider(
    tokenMcpCredentialId: string,
    provider: string
  ): Promise<OAuthCredential | null> {
    const credentials = await this.prisma.oAuthCredential.findFirst({
      where: {
        tokenMcpCredentialId,
        provider,
      },
    });

    return credentials;
  }

  /**
   * Get decrypted access token
   */
  async getAccessToken(tokenMcpCredentialId: string, provider: string): Promise<string | null> {
    const credentials = await this.findByTokenMcpCredentialAndProvider(tokenMcpCredentialId, provider);

    if (!credentials) {
      return null;
    }

    // Check if expired
    if (credentials.expiresAt && credentials.expiresAt < new Date()) {
      return null;
    }

    return decryptToken(credentials.accessToken);
  }

  /**
   * Get decrypted refresh token
   */
  async getRefreshToken(tokenMcpCredentialId: string, provider: string): Promise<string | null> {
    const credentials = await this.findByTokenMcpCredentialAndProvider(tokenMcpCredentialId, provider);

    if (!credentials || !credentials.refreshToken) {
      return null;
    }

    return decryptToken(credentials.refreshToken);
  }

  /**
   * Delete OAuth credentials
   */
  async delete(tokenMcpCredentialId: string, provider: string): Promise<void> {
    await this.prisma.oAuthCredential.deleteMany({
      where: {
        tokenMcpCredentialId,
        provider,
      },
    });
  }
}
