import { PrismaClient, Mcp } from '@prisma/client';

export interface McpCreate {
  namespace: string;
  url: string;
  author: string;
  description: string;
  version?: string;
  stateless?: boolean;
  tokenCost?: number;
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
    return await this.prisma.mcp.create({
      data: {
        namespace: data.namespace,
        url: data.url,
        author: data.author,
        description: data.description,
        version: data.version || '1.0.0',
        stateless: data.stateless ?? false,
        tokenCost: data.tokenCost ?? 0.000,
      },
    });
  }

  /**
   * Find MCP by ID
   */
  async findById(id: string): Promise<Mcp | null> {
    return await this.prisma.mcp.findUnique({
      where: { id },
    });
  }

  /**
   * Find MCP by namespace
   */
  async findByNamespace(namespace: string): Promise<Mcp | null> {
    return await this.prisma.mcp.findUnique({
      where: { namespace },
    });
  }

  /**
   * List all MCPs
   */
  async listAll(): Promise<Mcp[]> {
    return await this.prisma.mcp.findMany({
      orderBy: {
        createdAt: 'desc',
      },
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

    return await this.prisma.mcp.update({
      where: { id },
      data: updateData,
    });
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
