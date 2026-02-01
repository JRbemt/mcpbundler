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

  public decryptAuth(item: BundledMCPCredential): Omit<BundledMCPCredential, "authConfig"> & { authConfig: MCPAuthConfig } {
    if (!item.authConfig) {
      return {
        ...item,
        authConfig: MCPAuthConfigSchema.parse({ method: "none" }),
      };
    }

    try {
      const decrypted = decryptJSON(item.authConfig);
      return { ...item, authConfig: MCPAuthConfigSchema.parse(decrypted) };
    } catch (error) {
      logger.error({ credentialId: item.id, error }, "Failed to decrypt auth config");
    }

    return { ...item, authConfig: MCPAuthConfigSchema.parse({ method: "none" }) };
  }

  public encryptAuth(item: Omit<BundledMCPCredential, "authConfig"> & { authConfig: MCPAuthConfig }): BundledMCPCredential {
    return { ...item, authConfig: encryptJSON(item.authConfig) };
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
}
