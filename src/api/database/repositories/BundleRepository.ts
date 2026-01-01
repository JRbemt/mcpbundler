/**
 * Bundle Repository - Data access layer for bundle management
 *
 * Provides database operations for managing bundles, which are logical groupings
 * of MCP servers with associated permissions. Bundles allow users to organize
 * multiple MCP upstreams into reusable configurations with fine-grained access control.
 * 
 * @see schema.prisma
 */

import { PrismaClient, Prisma, MCPBundleEntry } from "@prisma/client";
import { MCPAuthConfig, McpPermissions } from "../../../core/config/schemas.js";
import { decryptJSON, isEncrypted } from "../../../core/auth/encryption.js";
import logger from "../../../utils/logger.js";
import { McpCredentialRepository } from "./McpCredentialRepository.js";

/**
 * Bundle with nested MCPBundleEntry and Mcp details
 * Generated from Prisma's include type for type safety
 */
export type BundleWithMcpsAndCreator = Prisma.BundleGetPayload<{
  include: {
    mcps: {
      include: { mcp: true };
    };
    createdBy: true;
  };
}>;

export type DecryptedBundle = Omit<BundleWithMcpsAndCreator, "mcps"> & {
  mcps: (Omit<BundleWithMcpsAndCreator["mcps"][number], "mcp"> & {
    mcp: BundleWithMcpsAndCreator["mcps"][number]["mcp"] & {
      auth?: MCPAuthConfig;
    };
  })[];
}


/**
 * MCPBundleEntry with nested Mcp details
 * Generated from Prisma's include type for type safety
 */
export type MCPBundleEntryWithMcp = Prisma.MCPBundleEntryGetPayload<{
  include: { mcp: true };
}>;

export class BundleRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Locate and decrypt credentials for all MCPs in a bundle
   */
  public async decryptBundle(bundle: BundleWithMcpsAndCreator | null, bundleTokenId: string, credentialRepo: McpCredentialRepository): Promise<DecryptedBundle | null> {
    if (!bundle) return null;

    const decryptedMcps = await Promise.all(
      bundle.mcps.map(async (mcpEntry) => {
        let auth: MCPAuthConfig | undefined;
        try {
          switch (mcpEntry.mcp.authStrategy) {
            case "NONE":
              auth = undefined;
              break;

            case "MASTER":
              if (mcpEntry.mcp.masterAuth && isEncrypted(mcpEntry.mcp.masterAuth)) {
                auth = decryptJSON<MCPAuthConfig>(mcpEntry.mcp.masterAuth);
                logger.debug({ mcpId: mcpEntry.mcp.id, authType: typeof auth, auth }, "Decrypted MASTER auth");
              }
              break;

            case "USER_SET":
              const credential = await credentialRepo.findByTokenAndMcp(
                bundleTokenId,
                mcpEntry.mcpId
              );
              if (credential) {
                auth = decryptJSON<MCPAuthConfig>(credential.authConfig);
                logger.debug({ mcpId: mcpEntry.mcp.id, authType: typeof auth, auth }, "Decrypted USER_SET auth");
              }
              break;

            default:
              logger.warn({ mcpId: mcpEntry.mcp.id, authStrategy: mcpEntry.mcp.authStrategy }, "Unknown auth strategy");
              auth = undefined;
          }
        } catch (error) {
          logger.error({ mcpId: mcpEntry.mcp.id, bundleId: bundle.id, error }, "Failed to decrypt auth");
          auth = undefined;
        }
        return {
          ...mcpEntry,
          mcp: {
            ...mcpEntry.mcp,
            auth,
          },
        };
      })
    );

    return { ...bundle, mcps: decryptedMcps };
  }

  /**
   * Create a new bundle
   *
   * @param name - Human-readable name for the bundle
   * @param description - Description of the bundle
   * @param createdById - Optional ID of the user creating this bundle
   * @returns Newly created bundle with nested MCP associations
   */
  async create(name: string, description: string, createdById?: string): Promise<BundleWithMcpsAndCreator> {
    return await this.prisma.bundle.create({
      data: {
        name,
        description,
        createdById,
      },
      include: {
        mcps: {
          include: {
            mcp: true,
          },
        },
        createdBy: true,
      },
    });
  }

  /**
   * Find bundle by ID
   *
   * @param id - UUID of the bundle to retrieve
   * @returns Bundle with nested MCPs, or null if not found
   */
  async findById(id: string): Promise<BundleWithMcpsAndCreator | null> {
    const bundle = await this.prisma.bundle.findUnique({
      where: { id },
      include: {
        mcps: {
          include: {
            mcp: true,
          },
        },
        createdBy: true,
      },
    });
    return bundle;
  }

  /**
   * List all bundles
   *
   * @returns All bundles ordered by creation date (newest first)
   */
  async list(): Promise<BundleWithMcpsAndCreator[]> {
    const bundles = await this.prisma.bundle.findMany({
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
   * List bundles created by a specific user
   *
   * @param createdById - UUID of the user who created the bundles
   * @returns Bundles created by the user, ordered by creation date (newest first)
   */
  async listByCreator(createdById: string): Promise<BundleWithMcpsAndCreator[]> {
    const bundles = await this.prisma.bundle.findMany({
      where: {
        createdById,
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
  async listByCreatorHierarchy(userIds: string[]): Promise<BundleWithMcpsAndCreator[]> {
    const bundles = await this.prisma.bundle.findMany({
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
    await this.prisma.bundle.delete({
      where: { id },
    });
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

    return await this.prisma.mCPBundleEntry.create({
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
   * Find MCP instance in bundle by MCPBundleEntry ID
   *
   * @param id - UUID of the MCPBundleEntry association record
   * @returns MCPBundleEntry with nested MCP details, or null if not found
   */
  async findMcpById(id: string): Promise<MCPBundleEntryWithMcp | null> {
    return await this.prisma.mCPBundleEntry.findUnique({
      where: { id },
      include: {
        mcp: true,
      },
    }) as MCPBundleEntryWithMcp | null;
  }

  /**
   * Find MCP in bundle by bundle ID and MCP ID
   *
   * @param bundleId - UUID of the bundle
   * @param mcpId - UUID of the MCP
   * @returns MCPBundleEntry association if exists, or null
   */
  async findMcpInBundle(
    bundleId: string,
    mcpId: string
  ): Promise<MCPBundleEntry | null> {
    return await this.prisma.mCPBundleEntry.findUnique({
      where: {
        bundleId_mcpId: {
          bundleId,
          mcpId,
        },
      },
    });
  }

  /**
   * List all MCPs in a bundle with their master definitions
   *
   * @param bundleId - UUID of the bundle
   * @returns All MCPs in the bundle ordered by when they were added (oldest first)
   */
  async listMcps(bundleId: string): Promise<MCPBundleEntryWithMcp[]> {
    return await this.prisma.mCPBundleEntry.findMany({
      where: { bundleId },
      include: {
        mcp: true,
      },
      orderBy: {
        addedAt: "asc",
      },
    }) as MCPBundleEntryWithMcp[];
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
    const updateData: any = {};

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

    return await this.prisma.mCPBundleEntry.update({
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
    await this.prisma.mCPBundleEntry.delete({
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
    await this.prisma.mCPBundleEntry.delete({
      where: { id },
    });
  }
}
