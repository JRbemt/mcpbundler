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
import { createHash } from "crypto";
import { encryptJSON, decryptJSON, isEncrypted } from "../../../core/auth/encryption.js";
import logger from "../../../utils/logger.js";

/**
 * MCP credential with nested Mcp details
 */
export type McpCredentialWithMcp = Prisma.BundledMCPCredentialGetPayload<{
  include: { mcp: true };
}>;
export class McpCredentialRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Decrypt auth config if encrypted
   *
   * Internal helper that decrypts the authConfig field if it's encrypted.
   * Returns empty string authConfig if decryption fails to prevent exposing encrypted data.
   *
   * @param credential - Credential record to decrypt
   * @returns Credential with decrypted auth config, or original if not encrypted/null
   */
  private decryptAuth(credential: BundledMCPCredential | null): BundledMCPCredential | null {
    if (!credential || !credential.authConfig) {
      return credential;
    }

    if (isEncrypted(credential.authConfig)) {
      try {
        const decrypted = decryptJSON(credential.authConfig);
        return { ...credential, authConfig: JSON.stringify(decrypted) };
      } catch (error) {
        logger.error({ credentialId: credential.id, error }, "Failed to decrypt auth config");
        return { ...credential, authConfig: "" };
      }
    }

    return credential;
  }

  /**
   * Resolve token string or ID to token ID
   *
   * Helper that accepts either a plaintext token (mcpb_*) or a token ID and
   * resolves it to the token ID. This provides flexibility in the API.
   *
   * @param tokenOrId - Token string (mcpb_*) or UUID token ID
   * @returns Token ID or null if not found
   */
  private async resolveTokenId(tokenOrId: string): Promise<string | null> {
    // If it starts with "mcpb_", it's a token string - hash and lookup
    if (tokenOrId.startsWith("mcpb_")) {
      const tokenHash = createHash("sha256").update(tokenOrId).digest("hex");
      const token = await this.prisma.bundleAccessToken.findUnique({
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
   *
   * Creates a new credential binding. The authConfig is encrypted before storage.
   *
   * @param tokenOrId - Token string (mcpb_*) or UUID token ID
   * @param namespace - MCP namespace to bind credentials for
   * @param authConfig - Authentication configuration (will be encrypted)
   * @returns Created credential record with decrypted config
   * @throws Error if token or MCP not found
   */
  async bind(
    tokenOrId: string,
    namespace: string,
    authConfig: any
  ): Promise<BundledMCPCredential> {
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

    const encrypted = encryptJSON(authConfig);
    logger.info({ tokenId, mcpId: mcp.id }, "Encrypting auth config for token-specific credential");

    const created = await this.prisma.bundledMCPCredential.create({
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
   *
   * Updates existing credential binding. The new authConfig is encrypted before storage.
   *
   * @param tokenOrId - Token string (mcpb_*) or UUID token ID
   * @param namespace - MCP namespace
   * @param authConfig - New authentication configuration (will be encrypted)
   * @returns Updated credential record with decrypted config
   * @throws Error if token or MCP not found
   */
  async update(
    tokenOrId: string,
    namespace: string,
    authConfig: any
  ): Promise<BundledMCPCredential> {
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

    const encrypted = encryptJSON(authConfig);
    logger.info({ tokenId, mcpId: mcp.id }, "Encrypting updated auth config for token-specific credential");

    const updated = await this.prisma.bundledMCPCredential.update({
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
   *
   * Deletes the credential binding permanently.
   *
   * @param tokenOrId - Token string (mcpb_*) or UUID token ID
   * @param namespace - MCP namespace
   * @throws Error if token or MCP not found
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

    await this.prisma.bundledMCPCredential.delete({
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
   *
   * @param tokenOrId - Token string (mcpb_*) or UUID token ID
   * @param namespace - MCP namespace
   * @returns Credential record with decrypted config, or null if not found
   */
  async findByTokenAndMcp(
    tokenOrId: string,
    namespace: string
  ): Promise<BundledMCPCredential | null> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      return null;
    }

    const credential = await this.prisma.bundledMCPCredential.findUnique({
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
   *
   * @param tokenOrId - Token string (mcpb_*) or UUID token ID
   * @returns Credential record with decrypted config, or null if not found
   */
  async findById(tokenOrId: string): Promise<BundledMCPCredential | null> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      return null;
    }
    const credential = await this.prisma.bundledMCPCredential.findUnique({
      where: { id: tokenId },
    });
    return this.decryptAuth(credential);
  }

  /**
   * List all credentials for a token
   *
   * @param tokenOrId - Token string (mcpb_*) or UUID token ID
   * @returns All credentials bound to the token, with nested MCP details and decrypted configs
   * @throws Error if token not found
   */
  async listByToken(tokenOrId: string): Promise<McpCredentialWithMcp[]> {
    const tokenId = await this.resolveTokenId(tokenOrId);
    if (!tokenId) {
      throw new Error(`Token not found: ${tokenOrId}`);
    }

    const credentials = await this.prisma.bundledMCPCredential.findMany({
      where: { tokenId },
      include: {
        mcp: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    }) as McpCredentialWithMcp[];

    return credentials.map((cred) => {
      const decrypted = this.decryptAuth(cred);
      return decrypted || cred;
    }) as McpCredentialWithMcp[];
  }

  /**
   * Check if credentials exist for a token+MCP combination
   *
   * @param tokenOrId - Token string (mcpb_*) or UUID token ID
   * @param namespace - MCP namespace
   * @returns True if credentials exist, false otherwise
   */
  async exists(tokenOrId: string, namespace: string): Promise<boolean> {
    const credential = await this.findByTokenAndMcp(tokenOrId, namespace);
    return credential !== null;
  }
}
