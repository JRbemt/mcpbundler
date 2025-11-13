import { PrismaClient, CollectionToken } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

/**
 * Repository for managing collection access tokens
 * Handles token generation, validation, and lifecycle management
 */
export class AccessTokenRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Generate a new collection access token
   * Returns both the token (plain) and the database record
   */
  async generate(
    collectionId: string,
    name: string,
    description?: string,
    expiresAt?: Date
  ): Promise<{ token: string; record: CollectionToken }> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const record = await this.prisma.collectionToken.create({
      data: {
        collectionId,
        name,
        description,
        tokenHash,
        expiresAt,
      },
    });

    return { token, record };
  }

  /**
   * Find token by hash
   */
  async findByHash(tokenHash: string): Promise<CollectionToken | null> {
    return await this.prisma.collectionToken.findUnique({
      where: { tokenHash },
    });
  }

  /**
   * Find token by plain token string
   */
  async findByToken(token: string): Promise<CollectionToken | null> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return await this.findByHash(tokenHash);
  }

  /**
   * Find token by ID
   */
  async findById(id: string): Promise<CollectionToken | null> {
    return await this.prisma.collectionToken.findUnique({
      where: { id },
    });
  }

  /**
   * List all tokens for a collection
   */
  async list(collectionId: string): Promise<CollectionToken[]> {
    return await this.prisma.collectionToken.findMany({
      where: { collectionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Revoke a token (mark as revoked)
   */
  async revoke(id: string): Promise<CollectionToken> {
    return await this.prisma.collectionToken.update({
      where: { id },
      data: { revoked: true },
    });
  }

  /**
   * Delete a token
   */
  async delete(id: string): Promise<void> {
    await this.prisma.collectionToken.delete({
      where: { id },
    });
  }

  /**
   * Check if token is valid (not revoked and not expired)
   */
  isValid(token: CollectionToken): boolean {
    if (token.revoked) {
      return false;
    }

    if (token.expiresAt && token.expiresAt < new Date()) {
      return false;
    }

    return true;
  }
}
