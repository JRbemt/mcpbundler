import { PrismaClient, CollectionTokenMcpCredential, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { encryptAuthConfig, decryptAuthConfig, isEncrypted } from '../../../utils/encryption.js';
import logger from '../../../utils/logger.js';

/**
 * MCP credential with nested Mcp details
 */
export type McpCredentialWithMcp = Prisma.CollectionTokenMcpCredentialGetPayload<{
  include: { mcp: true };
}>;

/**
 * Repository for managing token-specific MCP credentials
 * Handles binding user credentials to specific tokens for MCPs
 */
export class McpCredentialRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Decrypt auth config if encrypted
   */
  private decryptAuth(credential: CollectionTokenMcpCredential | null): CollectionTokenMcpCredential | null {
    if (!credential || !credential.authConfig) {
      return credential;
    }

    if (isEncrypted(credential.authConfig)) {
      try {
        const decrypted = decryptAuthConfig(credential.authConfig);
        return { ...credential, authConfig: JSON.stringify(decrypted) };
      } catch (error) {
        logger.error({ credentialId: credential.id, error }, 'Failed to decrypt auth config');
        return { ...credential, authConfig: '' };
      }
    }

    return credential;
  }

  /**
   * Resolve token string or ID to token ID
   * @param tokenOrId - Token string (mcpb_live_...) or token ID
   * @returns Token ID or null if not found
   */
  private async resolveTokenId(tokenOrId: string): Promise<string | null> {
    // If it starts with "mcpb_", it's a token string - hash and lookup
    if (tokenOrId.startsWith('mcpb_')) {
      const tokenHash = createHash('sha256').update(tokenOrId).digest('hex');
      const token = await this.prisma.collectionToken.findUnique({
        where: { tokenHash },
        select: { id: true },
      });
      return token?.id ?? null;
    }
    // Otherwise assume it's already a token ID
    return tokenOrId;
  }

  /**
   * Bind credentials to a token+MCP combination
   * @param tokenOrId - Token string (mcpb_live_...) or token ID
   * @param namespace - MCP namespace
   */
  async bind(
    tokenOrId: string,
    namespace: string,
    authConfig: any
  ): Promise<CollectionTokenMcpCredential> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      throw new Error(`Token not found: ${tokenOrId}`);
    }

    // Look up MCP to get its ID
    const mcp = await this.prisma.mcp.findUnique({
      where: { namespace },
    });

    if (!mcp) {
      throw new Error(`MCP not found: ${namespace}`);
    }

    const encrypted = encryptAuthConfig(authConfig);
    logger.info({ tokenId, mcpId: mcp.id }, 'Encrypting auth config for token-specific credential');

    const created = await this.prisma.collectionTokenMcpCredential.create({
      data: {
        tokenId,
        mcpId: mcp.id,
        authConfig: encrypted,
      },
    });

    return this.decryptAuth(created) || created;
  }

  /**
   * Update credentials for a token+MCP combination
   * @param tokenOrId - Token string (mcpb_live_...) or token ID
   * @param namespace - MCP namespace
   */
  async update(
    tokenOrId: string,
    namespace: string,
    authConfig: any
  ): Promise<CollectionTokenMcpCredential> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      throw new Error(`Token not found: ${tokenOrId}`);
    }

    const mcp = await this.prisma.mcp.findUnique({
      where: { namespace },
    });

    if (!mcp) {
      throw new Error(`MCP not found: ${namespace}`);
    }

    const encrypted = encryptAuthConfig(authConfig);
    logger.info({ tokenId, mcpId: mcp.id }, 'Encrypting updated auth config for token-specific credential');

    const updated = await this.prisma.collectionTokenMcpCredential.update({
      where: {
        tokenId_mcpId: {
          tokenId,
          mcpId: mcp.id,
        },
      },
      data: {
        authConfig: encrypted,
      },
    });

    return this.decryptAuth(updated) || updated;
  }

  /**
   * Remove credentials for a token+MCP combination
   * @param tokenOrId - Token string (mcpb_live_...) or token ID
   * @param namespace - MCP namespace
   */
  async remove(tokenOrId: string, namespace: string): Promise<void> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      throw new Error(`Token not found: ${tokenOrId}`);
    }

    const mcp = await this.prisma.mcp.findUnique({
      where: { namespace },
    });

    if (!mcp) {
      throw new Error(`MCP not found: ${namespace}`);
    }

    await this.prisma.collectionTokenMcpCredential.delete({
      where: {
        tokenId_mcpId: {
          tokenId,
          mcpId: mcp.id,
        },
      },
    });
  }

  /**
   * Find credential by token and MCP namespace
   * @param tokenOrId - Token string (mcpb_live_...) or token ID
   * @param namespace - MCP namespace
   */
  async findByTokenAndMcp(
    tokenOrId: string,
    namespace: string
  ): Promise<CollectionTokenMcpCredential | null> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      return null;
    }

    const credential = await this.prisma.collectionTokenMcpCredential.findUnique({
      where: {
        tokenId_mcpId: {
          tokenId,
          mcpId: namespace,
        },
      },
    });

    return this.decryptAuth(credential);
  }

  /**
   * Find credential by ID
   */
  async findById(tokenOrId: string): Promise<CollectionTokenMcpCredential | null> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      return null;
    }
    const credential = await this.prisma.collectionTokenMcpCredential.findUnique({
      where: { id: tokenId },
    });
    return this.decryptAuth(credential);
  }

  /**
   * List all credentials for a token
   * @param tokenOrId - Token string (mcpb_live_...) or token ID
   */
  async listByToken(tokenOrId: string): Promise<McpCredentialWithMcp[]> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      throw new Error(`Token not found: ${tokenOrId}`);
    }

    const credentials = await this.prisma.collectionTokenMcpCredential.findMany({
      where: { tokenId },
      include: {
        mcp: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    }) as McpCredentialWithMcp[];

    return credentials.map((cred) => {
      const decrypted = this.decryptAuth(cred);
      return decrypted || cred;
    }) as McpCredentialWithMcp[];
  }

  /**
   * Check if credentials exist for a token+MCP combination
   * @param tokenOrId - Token string (mcpb_live_...) or token ID
   * @param namespace - MCP namespace
   */
  async exists(tokenOrId: string, namespace: string): Promise<boolean> {
    const credential = await this.findByTokenAndMcp(tokenOrId, namespace);
    return credential !== null;
  }
}
