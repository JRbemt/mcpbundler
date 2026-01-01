/**
 * Access Token Repository - Secure token management for bundle access
 *
 * Manages the lifecycle of bundle access tokens, which are used to authenticate
 * client connections to the MCP bundler. Tokens are stored as SHA-256 hashes for
 * security, and the plaintext token is only returned once during generation.
 *
 * Key responsibilities:
 * - Access to named, described tokens
 * - Token validation and encryption
 */

import { PrismaClient, BundleAccessToken } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

export class AccessTokenRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Generate a new bundle access token
   *
   * Creates a cryptographically secure random token and stores its SHA-256 hash.
   * The plaintext token is only returned once and cannot be retrieved later.
   *
   * @param bundleId - UUID of the bundle this token grants access to
   * @param name - Human-readable name for the token
   * @param description - Optional description of the token's purpose
   * @param expiresAt - Optional expiration date/time
   * @param createdById - UUID of the user creating this token
   * @returns Object containing the plaintext token and database record
   */
  async generate(
    bundleId: string,
    name: string,
    createdById: string,
    description?: string,
    expiresAt?: Date,
  ): Promise<{ token: string; record: BundleAccessToken }> {
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const record = await this.prisma.bundleAccessToken.create({
      data: {
        bundleId,
        name,
        description,
        tokenHash,
        expiresAt,
        createdById,
      },
    });

    return { token, record };
  }

  /**
   * Find token by hash
   *
   * @param tokenHash - SHA-256 hash of the token
   * @returns Token record or null if not found
   */
  async findByHash(tokenHash: string): Promise<BundleAccessToken | null> {
    return await this.prisma.bundleAccessToken.findUnique({
      where: { tokenHash },
    });
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
    const tokenHash = createHash("sha256").update(token).digest("hex");
    return await this.findByHash(tokenHash);
  }

  /**
   * Find token by ID
   *
   * @param id - UUID of the token record
   * @returns Token record or null if not found
   */
  async findById(id: string): Promise<BundleAccessToken | null> {
    return await this.prisma.bundleAccessToken.findUnique({
      where: { id },
    });
  }

  /**
   * List all tokens for a bundle
   *
   * @param bundleId - UUID of the bundle
   * @returns All tokens for the bundle, ordered by creation date (newest first)
   */
  async list(bundleId: string): Promise<BundleAccessToken[]> {
    return await this.prisma.bundleAccessToken.findMany({
      where: { bundleId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Revoke a token (soft delete)
   *
   * Marks the token as revoked without deleting it from the database.
   * Revoked tokens will fail validation but remain in the audit trail.
   *
   * @param id - UUID of the token to revoke
   * @returns Updated token record with revoked flag set
   */
  async revoke(id: string): Promise<BundleAccessToken> {
    return await this.prisma.bundleAccessToken.update({
      where: { id },
      data: { revoked: true },
    });
  }

  /**
   * Delete a token permanently
   *
   * Removes the token from the database entirely. Consider using revoke() instead
   * to maintain audit history.
   *
   * @param id - UUID of the token to delete
   */
  async delete(id: string): Promise<void> {
    await this.prisma.bundleAccessToken.delete({
      where: { id },
    });
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
