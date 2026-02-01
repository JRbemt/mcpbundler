/**
 * MCP Credential Repository - Token-specific authentication management
 *
 * Manages token-specific authentication credentials for MCPs that use the USER_SET
 * auth strategy. This allows different bundle tokens to have their own unique
 * authentication credentials for the same MCP server, enabling multi-user scenarios.
 *
 * Authentication flow:
 * 1. User binds their credentials to an user-specific bundle token (this a token generated for a bundle)
 * 2. When token is used to connect, credentials are decrypted
 * 3. Decrypted credentials are used to authenticate with upstream MCP
 *
 * This enables scenarios where multiple users share a bundle but each
 * uses their own containerized credentials to access the underlying MCP servers.
 * 
 * @see schema.prisma
 */

import { PrismaClient, BundledMCPCredential, Prisma } from "@prisma/client";
import { Repository } from "../../domain/Repository.js";
import { MCPAuthConfig, MCPAuthConfigSchema } from "../../domain/entities.js";
import { decryptJSON, encryptJSON } from "../../utils/encryption.js";
import logger from "../../utils/logger.js";



export type TokenMcpCredentialWithMcp = Prisma.BundledMCPCredentialGetPayload<{
  include: { mcp: true };
}>;

export class BundledMcpCredentialRepository implements Repository<BundledMCPCredential, "id"> {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(item: Omit<BundledMCPCredential, "id" | "createdAt" | "updatedAt">): Promise<{ record: BundledMCPCredential }> {
    const record = await this.prisma.bundledMCPCredential.create({
      data: {
        ...item,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return { record };
  }

  async findById(id: string): Promise<BundledMCPCredential | null> {
    return await this.prisma.bundledMCPCredential.findUnique({
      where: { id },
    });
  }

  public decryptAuth(config: string): MCPAuthConfig {
    if (!config) {
      return MCPAuthConfigSchema.parse({ method: "none" });
    }

    try {
      const decrypted = decryptJSON(config);
      return MCPAuthConfigSchema.parse(decrypted);
    } catch (error) {
      logger.error("Failed to decrypt auth config");
    }

    return MCPAuthConfigSchema.parse({ method: "none" });
  }

  public encryptAuth(config: MCPAuthConfig): string {
    return encryptJSON(config);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.bundledMCPCredential.delete({
      where: { id },
    });
  }

  async findFirst(field: keyof Omit<BundledMCPCredential, "id" | "createdAt">, value: unknown): Promise<BundledMCPCredential | null> {
    return await this.prisma.bundledMCPCredential.findFirst({
      where: { [field]: value } as any,
    });
  }

  async update(item: Partial<Omit<BundledMCPCredential, "id" | "createdAt" | "updatedAt">> & { id: string }): Promise<BundledMCPCredential> {
    const { id, ...data } = item;
    return await this.prisma.bundledMCPCredential.update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  /**
   * List all credentials for a token
   *
   * @param token - Token string (mcpb_*)
   * @returns All credentials bound to the token, with nested MCP details and decrypted configs
   * @throws Error if token not found
   */
  async listByToken(id: string): Promise<TokenMcpCredentialWithMcp[]> {
    if (!id) {
      throw new Error(`Token not found ${id}`);
    }

    return await this.prisma.bundledMCPCredential.findMany({
      where: { tokenId: id },
      include: {
        mcp: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  }


  async exists(id: string): Promise<boolean> {
    return await this.findById(id) !== null;
  }

  /**
   * Find credential by token and MCP
   *
   * @param tokenId - UUID of the token
   * @param mcpId - UUID of the MCP
   * @returns Credential if found, null otherwise
   */
  async findByTokenAndMcp(tokenId: string, mcpId: string): Promise<BundledMCPCredential | null> {
    return await this.prisma.bundledMCPCredential.findFirst({
      where: { tokenId, mcpId },
    });
  }

  /**
   * Bind credentials to a token+MCP combination
   *
   * @param tokenId - UUID of the token
   * @param mcpId - UUID of the MCP
   * @param authConfig - Authentication configuration to encrypt and store
   * @returns Created credential record
   */
  async bind(tokenId: string, mcpId: string, authConfig: MCPAuthConfig): Promise<BundledMCPCredential> {
    const encryptedAuth = encryptJSON(authConfig);
    const record = await this.prisma.bundledMCPCredential.create({
      data: {
        tokenId,
        mcpId,
        authConfig: encryptedAuth,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    return record;
  }

  /**
   * Update credentials for a token+MCP combination
   *
   * @param tokenId - UUID of the token
   * @param mcpId - UUID of the MCP
   * @param authConfig - New authentication configuration
   * @returns Updated credential record
   */
  async updateByTokenAndMcp(tokenId: string, mcpId: string, authConfig: MCPAuthConfig): Promise<BundledMCPCredential> {
    const encryptedAuth = encryptJSON(authConfig);
    const existing = await this.findByTokenAndMcp(tokenId, mcpId);
    if (!existing) {
      throw new Error(`Credential not found for token ${tokenId} and MCP ${mcpId}`);
    }
    return await this.prisma.bundledMCPCredential.update({
      where: { id: existing.id },
      data: { authConfig: encryptedAuth, updatedAt: new Date() },
    });
  }

  /**
   * Remove credentials for a token+MCP combination
   *
   * @param tokenId - UUID of the token
   * @param mcpId - UUID of the MCP
   */
  async remove(tokenId: string, mcpId: string): Promise<void> {
    const existing = await this.findByTokenAndMcp(tokenId, mcpId);
    if (existing) {
      await this.prisma.bundledMCPCredential.delete({
        where: { id: existing.id },
      });
    }
  }
}
