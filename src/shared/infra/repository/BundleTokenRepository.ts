/**
 * Bundle Token Repository - Secure token management for bundle access
 *
 * Manages the lifecycle of bundle access tokens, which are used to authenticate
 * client connections to the MCP bundler. Tokens are stored as SHA-256 hashes for
 * security, and the plaintext token is only returned once during generation.
 *
 * Key responsibilities:
 * - Access to named, described tokens
 * - Token validation and encryption
 */

import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";
import { Repository } from "../../domain/Repository.js";
import { BundleAccessToken } from "../../domain/entities.js";
import { hashApiKey } from "../../utils/encryption.js";



export class BundleTokenRepository implements Repository<BundleAccessToken, "id"> {
  public client: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.client = prisma;
  }

  async create(item: Omit<BundleAccessToken, "id" | "tokenHash" | "createdAt">): Promise<{
    record: BundleAccessToken, token: string
  }> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashApiKey(token);

    const record = await this.client.bundleAccessToken.create({
      data: { ...item, tokenHash: tokenHash, createdAt: new Date() },
    });

    return { record: record, token: token };
  }

  async findFirst(field: keyof BundleAccessToken, value: unknown): Promise<BundleAccessToken | null> {
    const record = await this.client.bundleAccessToken.findUnique({
      where: { [field]: value },
    } as any);
    return record;
  }

  /**
   * Find token by plain token string
   *
   * Hashes the plaintext token and looks up the record by hash.
   *
   * @param token - Plaintext token string (e.g., from Authorization header)
   * @returns Token record or null if not found
   */
  async findByToken(token: string): Promise<BundleAccessToken | null> {
    const tokenHash = hashApiKey(token);
    return await this.findByHash(tokenHash);
  }

  /**
   * Find token by ID
   *
   * @param id - UUID of the token record
   * @returns Token record or null if not found
   */
  async findById(id: string): Promise<BundleAccessToken | null> {
    return await this.client.bundleAccessToken.findUnique({
      where: {
        id,
      }
    });
  }

  /**
 * Find token by hash
 *
 * @param tokenHash - SHA-256 hash of the token
 * @returns Token record or null if not found
 */
  async findByHash(tokenHash: string): Promise<BundleAccessToken | null> {
    return await this.findFirst("tokenHash", tokenHash);
  }

  /**
   * List all tokens for a bundle
   *
   * @param bundleId - UUID of the bundle
   * @returns All tokens for the bundle, ordered by creation date (newest first)
   */
  async list(bundleId: string): Promise<BundleAccessToken[]> {
    const tokens = await this.client.bundleAccessToken.findMany({
      where: { bundleId },
      orderBy: { createdAt: "desc" },
    });
    return tokens;
  }

  /**
   * Revoke a token (soft delete)
   *
   * Marks the token as revoked without deleting it from the database.
   * Revoked tokens will fail validation but remain in the audit trail.
   *
   * @param id - UUID of the token to revoke
   * @returns Result indicating success or failure
   */
  async delete(id: string): Promise<void> {
    await this.client.bundleAccessToken.update({
      where: { id },
      data: { revoked: true },
    });
  }

  async hardDelete(id: string): Promise<void> {
    await this.client.bundleAccessToken.delete({
      where: { id },
    });
  }

  async exists(id: string): Promise<boolean> {
    return this.findById(id) !== null;
  }

  async update(item: Partial<Omit<BundleAccessToken, "id" | "createdAt">> & { id: string }): Promise<BundleAccessToken> {
    const { id, ...data } = item;
    const record = await this.client.bundleAccessToken.update({
      where: { id },
      data: { ...data },
    });
    return record;
  }

  /**
   * Check if token is valid (not revoked and not expired)
   *
   * @param token - Token record to validate
   * @returns True if token is valid (not revoked and not expired), false otherwise
   */
  isValid(token: BundleAccessToken): boolean {
    if (token.revoked) {
      return false;
    }

    if (token.expiresAt && token.expiresAt < new Date()) {
      return false;
    }

    return true;
  }
}
