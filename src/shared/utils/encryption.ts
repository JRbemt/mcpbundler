/**
 * Encryption - AES-256-GCM encryption for sensitive data
 *
 * Encrypts credentials and auth configs using AES-256-GCM with authenticated
 * encryption. Requires ENCRYPTION_KEY environment variable (min 32 chars).
 * Encrypted format: iv:authTag:ciphertext (hex-encoded).
 *
 * Also provides API key generation (mcpb_ prefix) and SHA-256 hashing for
 * secure storage. All keys are validated on startup.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import logger from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const MIN_KEY_LENGTH = 32;

let cachedEncryptionKey: Buffer | null = null;

export const API_KEY_PREFIX = 'mcpb_';
const API_KEY_LENGTH = 48;

/**
 * Validates and retrieves the encryption key from environment
 * Caches the key for performance
 */
export function getEncryptionKey(): Buffer {
  if (cachedEncryptionKey) {
    return cachedEncryptionKey;
  }

  const key = process.env.ENCRYPTION_KEY;

  if (!key) {
    const error = 'FATAL: ENCRYPTION_KEY environment variable not set. Cannot encrypt credentials.';
    logger.error(error);
    throw new Error(error);
  }

  if (key.length < MIN_KEY_LENGTH) {
    logger.warn(`Encryption key is shorter than recommended ${MIN_KEY_LENGTH} characters`);
  }

  return createHash('sha256').update(key).digest();
}


/**
 * Encrypts sensitive data using AES-256-GCM
 * Returns format: iv:authTag:encrypted (hex-encoded)
 */
export function encrypt(plaintext: string): string {
  try {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (error) {
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypts data encrypted with encrypt()
 * Expects format: iv:authTag:encrypted
 */
export function decrypt(encryptedData: string): string {
  try {
    const parts = encryptedData.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Checks if a string appears to be encrypted (has the expected format)
 */
export function isEncrypted(data: string): boolean {
  if (!data) return false;

  const parts = data.split(':');
  if (parts.length !== 3) return false;

  try {
    const [ivHex, authTagHex, encrypted] = parts;
    return (
      ivHex.length === IV_LENGTH * 2 &&
      authTagHex.length === AUTH_TAG_LENGTH * 2 &&
      encrypted.length > 0 &&
      /^[0-9a-f]+$/i.test(ivHex) &&
      /^[0-9a-f]+$/i.test(authTagHex) &&
      /^[0-9a-f]+$/i.test(encrypted)
    );
  } catch {
    return false;
  }
}

/**
 * Encrypts a json object
 */
export function encryptJSON<T>(json: T): string {
  return encrypt(JSON.stringify(json));
}

/**
 * Decrypts and JSON parses a string
 */
export function decryptJSON<T>(encrypted: string): T {
  try {
    return JSON.parse(decrypt(encrypted)) as T;
  } catch (error) {
    throw new Error('Failed to decrypt authentication configuration');
  }
}


/**
 * Generates a cryptographically secure API key
 * Format: mcpb_admin_{random_hex}
 */
export function generateApiKey(): string {
  const randomHex = randomBytes(API_KEY_LENGTH).toString('hex');
  return `${API_KEY_PREFIX}${randomHex}`;
}

/**
 * Hashes an API key using SHA-256 for secure storage
 * This is deterministic (same input always produces same output),
 * unlike encrypt() which uses random IVs.
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}


/**
 * Validates API key format
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  return apiKey.startsWith(API_KEY_PREFIX) && apiKey.length >= API_KEY_PREFIX.length + 32;
}
/**
 * Validates encryption key is properly configured
 * Should be called on application startup
 */
export function validateEncryptionKey(): boolean {
  try {
    const key = getEncryptionKey();

    if (!key) {
      logger.error('ENCRYPTION_KEY not set in environment variables');
      return false;
    }

    if (key.length < MIN_KEY_LENGTH) {
      logger.warn(`ENCRYPTION_KEY is shorter than recommended ${MIN_KEY_LENGTH} characters`);
    }

    getEncryptionKey();
    logger.info('Encryption key validated successfully');
    return true;
  } catch (error) {
    logger.error({ error }, 'Failed to validate encryption key');
    return false;
  }
}