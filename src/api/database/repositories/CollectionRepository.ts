import { PrismaClient, Prisma, CollectionMcp, AuthStrategy } from '@prisma/client';
import { CollectionResponse, McpPermissions } from '../../../config/schemas.js';

/**
 * Collection with nested CollectionMcp and Mcp details
 * Generated from Prisma's include type for type safety
 */
export type CollectionWithMcps = Prisma.CollectionGetPayload<{
  include: {
    collectionMcps: {
      include: { mcp: true };
    };
  };
}>;

/**
 * CollectionMcp with nested Mcp details
 * Generated from Prisma's include type for type safety
 */
export type CollectionMcpWithMcp = Prisma.CollectionMcpGetPayload<{
  include: { mcp: true };
}>;

export class CollectionRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new collection
   */
  async create(name: string): Promise<CollectionWithMcps> {
    return await this.prisma.collection.create({
      data: {
        name,
      },
      include: {
        collectionMcps: {
          include: {
            mcp: true,
          },
        },
      },
    });
  }

  /**
   * Find collection by ID
   */
  async findById(id: string): Promise<CollectionWithMcps | null> {
    return await this.prisma.collection.findUnique({
      where: { id },
      include: {
        collectionMcps: {
          include: {
            mcp: true,
          },
        },
      },
    });
  }

  /**
   * List all collections
   */
  async list(): Promise<CollectionWithMcps[]> {
    return await this.prisma.collection.findMany({
      include: {
        collectionMcps: {
          include: {
            mcp: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Delete a collection
   */
  async delete(id: string): Promise<void> {
    await this.prisma.collection.delete({
      where: { id },
    });
  }

  /**
   * Convert database collection to CollectionResponse format
   * Note: Auth is NOT resolved here - it's resolved at runtime in session based on auth_strategy
   */
  toCollectionResponse(collection: CollectionWithMcps): CollectionResponse {
    return {
      collection_id: collection.id,
      user_id: 'system',
      name: collection.name,
      upstreams: collection.collectionMcps.map((collectionMcp) => ({
        namespace: collectionMcp.mcp.namespace,
        url: collectionMcp.mcp.url,
        author: collectionMcp.mcp.author,
        description: collectionMcp.mcp.description,
        version: collectionMcp.mcp.version,
        stateless: collectionMcp.mcp.stateless,
        auth_strategy: collectionMcp.authStrategy,
        auth: undefined, // Resolved at runtime based on auth_strategy
        token_cost: collectionMcp.mcp.tokenCost,
        permissions: {
          allowed_tools: JSON.parse(collectionMcp.allowedTools),
          allowed_resources: JSON.parse(collectionMcp.allowedResources),
          allowed_prompts: JSON.parse(collectionMcp.allowedPrompts),
        },
      })),
    };
  }

  /**
   * Add MCP to collection with auth strategy and permissions
   */
  async addMcp(
    collectionId: string,
    mcpId: string,
    authStrategy?: AuthStrategy,
    permissions?: McpPermissions
  ): Promise<CollectionMcp> {
    const allowedTools = permissions?.allowed_tools ?? ['*'];
    const allowedResources = permissions?.allowed_resources ?? ['*'];
    const allowedPrompts = permissions?.allowed_prompts ?? ['*'];

    return await this.prisma.collectionMcp.create({
      data: {
        collectionId,
        mcpId,
        authStrategy: authStrategy ?? 'MASTER',
        allowedTools: JSON.stringify(allowedTools),
        allowedResources: JSON.stringify(allowedResources),
        allowedPrompts: JSON.stringify(allowedPrompts),
      },
    });
  }

  /**
   * Find MCP instance in collection by CollectionMcp ID
   */
  async findMcpById(id: string): Promise<CollectionMcpWithMcp | null> {
    return await this.prisma.collectionMcp.findUnique({
      where: { id },
      include: {
        mcp: true,
      },
    }) as CollectionMcpWithMcp | null;
  }

  /**
   * Find MCP in collection by collection ID and MCP ID
   */
  async findMcpInCollection(
    collectionId: string,
    mcpId: string
  ): Promise<CollectionMcp | null> {
    return await this.prisma.collectionMcp.findUnique({
      where: {
        collectionId_mcpId: {
          collectionId,
          mcpId,
        },
      },
    });
  }

  /**
   * List all MCPs in a collection with their master definitions
   */
  async listMcps(collectionId: string): Promise<CollectionMcpWithMcp[]> {
    return await this.prisma.collectionMcp.findMany({
      where: { collectionId },
      include: {
        mcp: true,
      },
      orderBy: {
        addedAt: 'asc',
      },
    }) as CollectionMcpWithMcp[];
  }

  /**
   * Update MCP configuration in collection (auth strategy and permissions)
   */
  async updateMcpConfig(
    collectionId: string,
    mcpId: string,
    authStrategy?: AuthStrategy,
    permissions?: McpPermissions
  ): Promise<CollectionMcp> {
    const updateData: any = {};

    if (authStrategy !== undefined) {
      updateData.authStrategy = authStrategy;
    }

    if (permissions !== undefined) {
      if (permissions.allowed_tools !== undefined) {
        updateData.allowedTools = JSON.stringify(permissions.allowed_tools);
      }
      if (permissions.allowed_resources !== undefined) {
        updateData.allowedResources = JSON.stringify(permissions.allowed_resources);
      }
      if (permissions.allowed_prompts !== undefined) {
        updateData.allowedPrompts = JSON.stringify(permissions.allowed_prompts);
      }
    }

    return await this.prisma.collectionMcp.update({
      where: {
        collectionId_mcpId: {
          collectionId,
          mcpId,
        },
      },
      data: updateData,
    });
  }

  /**
   * Remove MCP from collection
   */
  async removeMcp(collectionId: string, mcpId: string): Promise<void> {
    await this.prisma.collectionMcp.delete({
      where: {
        collectionId_mcpId: {
          collectionId,
          mcpId,
        },
      },
    });
  }

  /**
   * Delete MCP instance from collection by CollectionMcp ID
   */
  async deleteMcpById(id: string): Promise<void> {
    await this.prisma.collectionMcp.delete({
      where: { id },
    });
  }
}
