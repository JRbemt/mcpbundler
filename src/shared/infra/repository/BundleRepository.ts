/**
 * Bundle Repository - Data access layer for bundle management
 *
 * Provides database operations for managing bundles, which are logical groupings
 * of MCP servers with associated permissions. Bundles allow users to organize
 * multiple MCP upstreams into reusable configurations with fine-grained access control.
 * 
 * @see schema.prisma
 */


import { Prisma } from "../../domain/entities.js";
import { Repository } from "../../domain/Repository.js";
import { Bundle, McpPermissions, MCPBundleEntry, PrismaClient, CreatedBundle } from "../../domain/entities.js";
import logger from "../../utils/logger.js";

export type BundleWithMcpsAndCreator = Prisma.BundleGetPayload<{
  include: {
    mcps: {
      include: { mcp: true };
    };
    createdBy: {
      select: { id: true, name: true };
    };
  };
}>;


export class BundleRepository implements Repository<Bundle, "id"> {
  public client: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.client = prisma;
  }


  async create(item: Omit<Bundle, "id" | "createdAt" | "updatedAt">): Promise<{ record: CreatedBundle; }> {
    const record = await this.client.bundle.create({
      data: { ...item, createdAt: new Date(), updatedAt: new Date() },
      include: {
        createdBy: { select: { id: true, name: true } },
      }
    });
    return { record };
  }

  /**
   * Find bundle by ID
   *
   * @param id - UUID of the bundle to retrieve
   * @returns Bundle with nested MCPs, or null if not found
   */
  async findById(id: string): Promise<BundleWithMcpsAndCreator | null> {
    const bundle = await this.client.bundle.findUnique({
      where: { id },
      include: {
        mcps: {
          include: {
            mcp: true,
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
    return bundle;
  }

  async findFirst(field: keyof Bundle, value: unknown): Promise<BundleWithMcpsAndCreator | null> {
    const bundle = await this.client.bundle.findFirst({
      where: { [field]: value } as any,
      include: {
        mcps: {
          include: {
            mcp: true,
          },
        },
        createdBy: { select: { id: true, name: true } },
      },
    });
    return bundle;
  }


  async findMany(field: keyof Bundle, value: unknown): Promise<BundleWithMcpsAndCreator[]> {
    const bundles = await this.client.bundle.findMany({
      where: {
        [field]: value,
      },
      include: {
        mcps: {
          include: {
            mcp: true,
          },
        },
        createdBy: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    return bundles;
  }

  /**
   * List bundles created by user or their descendants
   *
   * Returns all bundles created by the specified user OR by any users they created,
   * recursively. This supports hierarchical access control where a user can view
   * and manage bundles created by their entire descendant tree.
   *
   * @param userIds - Array of user IDs (user and all descendants)
   * @returns Bundles created by any of the specified users, ordered by creation date (newest first)
   */
  async listByCreators(userIds: string[]): Promise<BundleWithMcpsAndCreator[]> {
    const bundles = await this.client.bundle.findMany({
      where: {
        createdById: {
          in: userIds,
        },
      },
      include: {
        mcps: {
          include: {
            mcp: true,
          },
        },
        createdBy: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    return bundles;
  }

  /**
   * Delete a bundle
   *
   * @param id - UUID of the bundle to delete
   */
  async delete(id: string): Promise<void> {
    const record = await this.client.bundle.delete({
      where: { id },
    });
    logger.info({ apiKeyId: id, name: record.name }, "Revoked API key");
  }


  async update(item: Partial<Omit<Bundle, "id" | "createdAt">> & { id: string }): Promise<Bundle> {
    const { id, ...data } = item;
    const record = await this.client.bundle.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
    return record;
  }

  async exists(id: string): Promise<boolean> {
    return this.findById(id) !== null;
  }

  /**
   * Add MCP to bundle with permissions
   *
   * Creates an association between a bundle and an MCP with optional permission
   * restrictions. If no permissions are specified, defaults to wildcard access ('*')
   * for all capability types.
   *
   * @param bundleId - UUID of the bundle
   * @param mcpId - UUID of the MCP to add
   * @param permissions - Optional permission restrictions for tools, resources, and prompts
   * @returns Created MCPBundleEntry association record
   */
  async addMcp(
    bundleId: string,
    mcpId: string,
    permissions?: McpPermissions
  ): Promise<MCPBundleEntry> {
    const allowedTools = permissions?.allowedTools ?? ["*"];
    const allowedResources = permissions?.allowedResources ?? ["*"];
    const allowedPrompts = permissions?.allowedPrompts ?? ["*"];

    return await this.client.mCPBundleEntry.create({
      data: {
        bundleId,
        mcpId,
        allowedTools: JSON.stringify(allowedTools),
        allowedResources: JSON.stringify(allowedResources),
        allowedPrompts: JSON.stringify(allowedPrompts),
      },
    });
  }

  /**
 * List all bundles
 *
 * @returns All bundles ordered by creation date (newest first)
 */
  async list(): Promise<BundleWithMcpsAndCreator[]> {
    const bundles = await this.client.bundle.findMany({
      include: {
        mcps: {
          include: {
            mcp: true,
          },
        },
        createdBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    return bundles;
  }

  /**
   * Update MCP permissions in bundle
   *
   * Updates the permission configuration for an MCP within a bundle. Only the
   * provided permission fields will be updated; undefined fields are left unchanged.
   *
   * @param bundleId - UUID of the bundle
   * @param mcpId - UUID of the MCP
   * @param permissions - Permission updates (only specified fields are updated)
   * @returns Updated MCPBundleEntry association record
   */
  async updateMcpConfig(
    bundleId: string,
    mcpId: string,
    permissions?: McpPermissions
  ): Promise<MCPBundleEntry> {
    const updateData: Partial<Pick<MCPBundleEntry, "allowedTools" | "allowedResources" | "allowedPrompts">> = {};

    if (permissions !== undefined) {
      if (permissions.allowedTools !== undefined) {
        updateData.allowedTools = JSON.stringify(permissions.allowedTools);
      }
      if (permissions.allowedResources !== undefined) {
        updateData.allowedResources = JSON.stringify(permissions.allowedResources);
      }
      if (permissions.allowedPrompts !== undefined) {
        updateData.allowedPrompts = JSON.stringify(permissions.allowedPrompts);
      }
    }

    return await this.client.mCPBundleEntry.update({
      where: {
        bundleId_mcpId: {
          bundleId,
          mcpId,
        },
      },
      data: updateData,
    });
  }

  /**
   * Remove MCP from bundle
   *
   * @param bundleId - UUID of the bundle
   * @param mcpId - UUID of the MCP to remove
   */
  async removeMcp(bundleId: string, mcpId: string): Promise<void> {
    await this.client.mCPBundleEntry.delete({
      where: {
        bundleId_mcpId: {
          bundleId,
          mcpId,
        },
      },
    });
  }

  /**
   * Delete MCP instance from bundle by MCPBundleEntry ID
   *
   * @param id - UUID of the MCPBundleEntry association record to delete
   */
  async deleteMcpById(id: string): Promise<void> {
    await this.client.mCPBundleEntry.delete({
      where: { id },
    });
  }

  /**
   * Find MCP entry in bundle
   *
   * @param bundleId - UUID of the bundle
   * @param mcpId - UUID of the MCP
   * @returns MCPBundleEntry if found, null otherwise
   */
  async findMcpInBundle(bundleId: string, mcpId: string): Promise<MCPBundleEntry | null> {
    return await this.client.mCPBundleEntry.findUnique({
      where: {
        bundleId_mcpId: {
          bundleId,
          mcpId,
        },
      },
    });
  }
}
