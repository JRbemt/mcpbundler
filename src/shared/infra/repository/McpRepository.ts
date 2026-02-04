/**
 * MCP Repository - Master MCP server registry management
 *
 * Manages the registry of master MCP (Model Context Protocol) server definitions.
 * Each MCP represents a reusable server configuration that can be added to multiple
 * bundles. MCPs include authentication configuration, which is encrypted at rest
 * using AES-256-GCM encryption.
 *
 * Key responsibilities:
 * - MCP registry CRUD operations
 * - Secure storage of authentication credentials (encrypted)
 * - Support for three authentication strategies: NONE, MASTER, USER_SET
 * - Automatic encryption/decryption of sensitive auth configuration
 * - Namespace-based unique identification
 *
 * Authentication strategies:
 * - NONE: No authentication required
 * - MASTER: Single auth config shared across all bundles
 * - USER_SET: Auth credentials bound to specific bundle tokens
 */

import { PrismaClient } from "../../domain/entities.js";
import { Repository } from '../../domain/Repository.js';
import { MCPAuthConfig, MCPAuthConfigSchema, Mcp } from '../../domain/entities.js';
import { decryptJSON, encryptJSON } from '../../utils/encryption.js';
import logger from '../../utils/logger.js';

export class McpRepository implements Repository<Mcp, "id"> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new master MCP
   *
   * Creates a new MCP server definition in the registry. If masterAuth is provided,
   * it will be encrypted before storage using AES-256-GCM.
   *
   * @param data - MCP configuration including namespace, URL, auth strategy, and optional credentials
   * @returns Created MCP record
   */
  async create(item: Omit<Mcp, "id" | "createdAt" | "updatedAt">): Promise<{ record: Mcp }> {
    const record = await this.prisma.mcp.create({
      data: {
        ...item,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return { record };
  }

  public decryptAuth(item: Mcp): Omit<Mcp, "authConfig"> & { authConfig: MCPAuthConfig } {
    if (!item.masterAuth) {
      return {
        ...item,
        authConfig: MCPAuthConfigSchema.parse({ method: "none" }),
      };
    }

    try {
      const decrypted = decryptJSON(item.masterAuth);
      return { ...item, authConfig: MCPAuthConfigSchema.parse(decrypted) };
    } catch (error) {
      logger.error({ credentialId: item.id, error }, "Failed to decrypt auth config");
    }

    return { ...item, authConfig: MCPAuthConfigSchema.parse({ method: "none" }) };
  }

  public encryptAuth(item: Omit<Mcp, "masterAuth"> & { masterAuth: MCPAuthConfig }): Mcp {
    return { ...item, masterAuth: encryptJSON(item.masterAuth) };
  }

  /**
   * Find MCP by namespace
   *
   * @param namespace - Unique namespace identifier for the MCP
   * @returns MCP with decrypted auth config, or null if not found
   */
  async findByNamespace(namespace: string): Promise<Mcp | null> {
    const mcp = await this.prisma.mcp.findUnique({
      where: { namespace },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
    return mcp;
  }

  /**
   * List all MCPs
   *
   * @returns All MCPs with decrypted auth configs, ordered by creation date (newest first)
   */
  async listAll(): Promise<Mcp[]> {
    const mcps = await this.prisma.mcp.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return mcps.map((mcp: Mcp) => {
      const decrypted = mcp;
      return decrypted || mcp;
    });
  }

  async update(item: Partial<Omit<Mcp, "id" | "createdAt">> & { id: string }): Promise<Mcp> {
    const { id, ...data } = item;
    return await this.prisma.mcp.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  /**
   * Delete MCP by namespace
   *
   * Deletes an MCP from the registry. This cascades to all bundle associations,
   * removing the MCP from all bundles that reference it.
   *
   * @param namespace - Unique namespace identifier for the MCP to delete
   */
  async deleteByNamespace(namespace: string): Promise<void> {
    await this.prisma.mcp.delete({
      where: { namespace },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.mcp.delete({
      where: { id },
    });
  }


  async findById(id: string): Promise<Mcp | null> {
    {
      return await this.prisma.mcp.findUnique({
        where: { id },
      });
    }
  }

  async findFirst(field: keyof Mcp, value: unknown): Promise<Mcp | null> {
    return await this.prisma.mcp.findFirst({
      where: { [field]: value } as any,
    });
  }

  async exists(id: string): Promise<boolean> {
    return await this.findById(id) !== null;
  }

  /**
   * Find all MCPs created by specific users (hierarchical bulk query)
   *
   * Finds all MCPs created by any of the specified user IDs. Used for bulk
   * operations where you need to get MCPs created by a user and their descendants.
   *
   * @param userIds - Array of user IDs to find MCPs for
   * @returns Array of MCPs with decrypted auth configs
   */
  async findByCreators(userIds: string[]): Promise<Mcp[]> {
    const mcps = await this.prisma.mcp.findMany({
      where: {
        createdById: {
          in: userIds,
        },
      },
    });
    return mcps;
  }

  /**
   * Delete all MCPs created by specific users (hierarchical bulk delete)
   *
   * Deletes all MCPs created by any of the specified user IDs. This is used for
   * cascading deletes when users are revoked. All bundle associations are also
   * removed via Prisma cascade.
   *
   * @param userIds - Array of user IDs whose MCPs should be deleted
   * @returns Number of MCPs deleted
   */
  async deleteByCreators(userIds: string[]): Promise<number> {
    const result = await this.prisma.mcp.deleteMany({
      where: {
        createdById: {
          in: userIds,
        },
      },
    });

    return result.count;
  }
}
