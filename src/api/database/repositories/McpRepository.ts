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

import { PrismaClient, Mcp, Prisma } from '@prisma/client';
import { encryptJSON } from '../../../core/auth/encryption.js';
import logger from '../../../utils/logger.js';
import { MCPAuthConfig } from '../../../core/index.js';

type McpCreateEncrypted = Omit<Prisma.McpCreateInput, 'createdBy' | 'mcps' | 'bundledMcpToken' | 'createdAt' | 'updatedAt'>

export type McpCreate = Omit<McpCreateEncrypted, "masterAuth"> & {
  masterAuth?: MCPAuthConfig
};



export class McpRepository {
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
  async create(data: McpCreate, createdById: string): Promise<Mcp> {
    const encrypted: McpCreateEncrypted = {
      ...data,
      masterAuth: data.masterAuth ? encryptJSON(data.masterAuth) : undefined
    };

    return await this.prisma.mcp.create({
      data: { ...encrypted, createdById },
    });
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

    return mcps.map((mcp) => {
      const decrypted = mcp;
      return decrypted || mcp;
    });
  }

  /**
   * Update MCP
   *
   * Updates an existing MCP. Only provided fields will be updated. If masterAuth
   * is provided, it will be encrypted before storage.
   *
   * @param id - UUID of the MCP to update
   * @param data - Partial MCP data to update
   * @returns Updated MCP with decrypted auth config
   */
  async update(id: string, data: Partial<McpCreate>): Promise<Mcp> {
    const encrypted: Partial<McpCreateEncrypted> = {
      ...data,
      // prisma ignores undefined in updates
      masterAuth: data.masterAuth ? encryptJSON(data.masterAuth) : undefined
    }

    const updated = await this.prisma.mcp.update({
      where: { id },
      data: encrypted,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    return updated;
  }

  /**
   * Delete MCP by namespace
   *
   * Deletes an MCP from the registry. This cascades to all bundle associations,
   * removing the MCP from all bundles that reference it.
   *
   * @param namespace - Unique namespace identifier for the MCP to delete
   */
  async delete(namespace: string): Promise<void> {
    await this.prisma.mcp.delete({
      where: { namespace },
    });
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
