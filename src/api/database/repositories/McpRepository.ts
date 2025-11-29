import { PrismaClient, Mcp } from '@prisma/client';
import { encryptAuthConfig, decryptAuthConfig, isEncrypted } from '../../../utils/encryption.js';
import logger from '../../../utils/logger.js';

export interface McpCreate {
  namespace: string;
  url: string;
  author: string;
  description: string;
  version?: string;
  stateless?: boolean;
  tokenCost?: number;
  masterAuthConfig?: any;
  authStrategy?: 'NONE' | 'MASTER' | 'TOKEN_SPECIFIC';
  createdById?: string;
}

export class McpRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new master MCP
   */
  async create(data: McpCreate): Promise<Mcp> {
    const createData: any = {
      namespace: data.namespace,
      url: data.url,
      author: data.author,
      description: data.description,
      version: data.version || '1.0.0',
      stateless: data.stateless ?? false,
      tokenCost: data.tokenCost ?? 0.000,
      authStrategy: data.authStrategy || 'NONE',
      createdById: data.createdById,
    };

    if (data.masterAuthConfig) {
      createData.masterAuthConfig = encryptAuthConfig(data.masterAuthConfig);
      logger.info({ namespace: data.namespace }, 'Encrypting master auth config for new MCP');
    }

    return await this.prisma.mcp.create({
      data: createData,
    });
  }

  /**
   * Decrypt master auth config if encrypted
   */
  private decryptMasterAuth(mcp: Mcp | null): Mcp | null {
    if (!mcp || !mcp.masterAuthConfig) {
      return mcp;
    }

    if (isEncrypted(mcp.masterAuthConfig)) {
      try {
        const decrypted = decryptAuthConfig(mcp.masterAuthConfig);
        return { ...mcp, masterAuthConfig: JSON.stringify(decrypted) };
      } catch (error) {
        logger.error({ mcpId: mcp.id, error }, 'Failed to decrypt master auth config');
        return { ...mcp, masterAuthConfig: null };
      }
    }

    return mcp;
  }

  /**
   * Find MCP by ID
   */
  async findById(id: string): Promise<Mcp | null> {
    const mcp = await this.prisma.mcp.findUnique({
      where: { id },
    });
    return this.decryptMasterAuth(mcp);
  }

  /**
   * Find MCP by namespace
   */
  async findByNamespace(namespace: string): Promise<Mcp | null> {
    const mcp = await this.prisma.mcp.findUnique({
      where: { namespace },
    });
    return this.decryptMasterAuth(mcp);
  }

  /**
   * List all MCPs
   */
  async listAll(): Promise<Mcp[]> {
    const mcps = await this.prisma.mcp.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });

    return mcps.map((mcp) => {
      const decrypted = this.decryptMasterAuth(mcp);
      return decrypted || mcp;
    });
  }

  /**
   * Update MCP
   */
  async update(id: string, data: Partial<McpCreate>): Promise<Mcp> {
    const updateData: any = {};

    if (data.url !== undefined) updateData.url = data.url;
    if (data.author !== undefined) updateData.author = data.author;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.version !== undefined) updateData.version = data.version;
    if (data.stateless !== undefined) updateData.stateless = data.stateless;
    if (data.tokenCost !== undefined) updateData.tokenCost = data.tokenCost;
    if (data.authStrategy !== undefined) updateData.authStrategy = data.authStrategy;

    if (data.masterAuthConfig !== undefined) {
      updateData.masterAuthConfig = data.masterAuthConfig ? encryptAuthConfig(data.masterAuthConfig) : null;
      logger.info({ mcpId: id }, 'Encrypting updated master auth config');
    }

    const updated = await this.prisma.mcp.update({
      where: { id },
      data: updateData,
    });

    return this.decryptMasterAuth(updated) || updated;
  }

  /**
   * Delete MCP by namespace (cascades to collection instances)
   */
  async delete(namespace: string): Promise<void> {
    await this.prisma.mcp.delete({
      where: { namespace },
    });
  }
}
