import { PrismaClient, ApiUser, PermissionType, Prisma } from "@prisma/client";
import logger from "../../../utils/logger.js";
import { generateApiKey, hashApiKey } from "../../../utils/encryption.js";

export type ApiUserWithPermissions = Prisma.ApiUserGetPayload<{
  include: { permissions: true };
}>;

/**
 * Repository for managing admin API keys
 * Handles creation, validation, and revocation of API keys
 */
export class ApiUserRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new API key
   * Returns the plaintext key (ONLY TIME IT"S VISIBLE)
   */
  async create(
    name: string,
    contact: string,
    isAdmin: boolean = true
  ): Promise<{ apiKey: ApiUser; plaintextKey: string }> {
    const plaintextKey = generateApiKey();
    const keyHash = hashApiKey(plaintextKey);

    const apiKey = await this.prisma.apiUser.create({
      data: {
        name,
        contact,
        keyHash,
        isAdmin,
      },
    });

    logger.info({ apiKeyId: apiKey.id, name }, "Created new admin API key");

    return {
      apiKey,
      plaintextKey,
    };
  }

  /**
   * Find API key by hash
   */
  async findByHash(keyHash: string): Promise<ApiUser | null> {
    return await this.prisma.apiUser.findUnique({
      where: { keyHash },
    });
  }

  /**
   * Validate an API key and update lastUsedAt
   * Returns the API key record if valid, null otherwise
   */
  async validateAndUpdate(plaintextKey: string): Promise<ApiUser | null> {
    const keyHash = hashApiKey(plaintextKey);
    const apiKey = await this.findByHash(keyHash);

    if (!apiKey) {
      logger.warn({ keyHash: keyHash.substring(0, 8) }, "API key not found");
      return null;
    }

    if (apiKey.revokedAt) {
      logger.warn({ apiKeyId: apiKey.id, revokedAt: apiKey.revokedAt }, "Attempted use of revoked API key");
      return null;
    }

    await this.prisma.apiUser.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return apiKey;
  }

  /**
   * Revoke an API key
   */
  async revoke(id: string): Promise<ApiUser> {
    const apiKey = await this.prisma.apiUser.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    logger.info({ apiKeyId: id, name: apiKey.name }, "Revoked admin API key");

    return apiKey;
  }

  /**
   * List all API keys
   */
  async listAll(): Promise<ApiUser[]> {
    return await this.prisma.apiUser.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  /**
   * Delete an API key permanently
   */
  async delete(id: string): Promise<void> {
    await this.prisma.apiUser.delete({
      where: { id },
    });

    logger.info({ apiKeyId: id }, "Deleted admin API key");
  }

  /**
   * Find API user by name
   */
  async findByName(name: string): Promise<ApiUser | null> {
    return await this.prisma.apiUser.findFirst({
      where: { name },
    });
  }

  /**
   * Find API user by contact (email)
   */
  async findByContact(contact: string): Promise<ApiUser | null> {
    return await this.prisma.apiUser.findFirst({
      where: { contact },
    });
  }

  /**
   * List API users with optional filters
   */
  async list(options?: { includeRevoked?: boolean }): Promise<ApiUser[]> {
    const where: Prisma.ApiUserWhereInput = {};

    if (!options?.includeRevoked) {
      where.revokedAt = null;
    }

    return await this.prisma.apiUser.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
    });
  }

  /**
   * Update API user details
   */
  async update(
    userId: string,
    data: Partial<Pick<ApiUser, "name" | "department" | "contact">>
  ): Promise<ApiUser> {
    const user = await this.prisma.apiUser.update({
      where: { id: userId },
      data,
    });

    logger.info({ userId, updates: Object.keys(data) }, "Updated API user");

    return user;
  }

  /**
   * Get user with permissions
   */
  async getWithPermissions(userId: string): Promise<ApiUserWithPermissions | null> {
    return await this.prisma.apiUser.findUnique({
      where: { id: userId },
      include: { permissions: true },
    });
  }

  /**
   * Recursively add permission to user and optionally all their descendants
   */
  private async addPermissionCascade(
    userId: string,
    permission: PermissionType,
    affectedIds: string[]
  ): Promise<void> {
    try {
      await this.prisma.apiUserPermission.create({
        data: {
          userId,
          permission,
        },
      });
      affectedIds.push(userId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        logger.debug({ userId, permission }, "Permission already exists, skipping");
      } else {
        throw error;
      }
    }

    const createdUsers = await this.prisma.apiUser.findMany({
      where: { createdById: userId, revokedAt: null },
      select: { id: true },
    });

    for (const user of createdUsers) {
      await this.addPermissionCascade(user.id, permission, affectedIds);
    }
  }

  /**
   * Recursively remove permission from user and all their descendants
   */
  private async removePermissionCascade(
    userId: string,
    permission: PermissionType,
    affectedIds: string[]
  ): Promise<void> {
    const result = await this.prisma.apiUserPermission.deleteMany({
      where: {
        userId,
        permission,
      },
    });

    if (result.count > 0) {
      affectedIds.push(userId);
    }

    const createdUsers = await this.prisma.apiUser.findMany({
      where: { createdById: userId, revokedAt: null },
      select: { id: true },
    });

    for (const user of createdUsers) {
      await this.removePermissionCascade(user.id, permission, affectedIds);
    }
  }

  /**
   * Add permission to user with optional cascade to descendants
   */
  async addPermission(
    userId: string,
    permission: PermissionType,
    granterId: string,
    propagate: boolean = false
  ): Promise<number> {
    const affectedIds: string[] = [];

    if (propagate) {
      await this.addPermissionCascade(userId, permission, affectedIds);
      logger.info(
        { userId, permission, granterId, affectedCount: affectedIds.length },
        "Added permission with cascade"
      );
    } else {
      try {
        await this.prisma.apiUserPermission.create({
          data: {
            userId,
            permission,
          },
        });
        affectedIds.push(userId);
        logger.info({ userId, permission, granterId }, "Added permission to user");
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          logger.debug({ userId, permission }, "Permission already exists");
        } else {
          throw error;
        }
      }
    }

    return affectedIds.length;
  }

  /**
   * Remove permission from user and cascade to all descendants
   */
  async removePermission(userId: string, permission: PermissionType): Promise<number> {
    const affectedIds: string[] = [];

    await this.removePermissionCascade(userId, permission, affectedIds);

    logger.info(
      { userId, permission, affectedCount: affectedIds.length },
      "Removed permission with cascade"
    );

    return affectedIds.length;
  }

  /**
   * Check if granter can grant the specified permissions
   */
  async canGrantPermissions(granterId: string, permissions: PermissionType[]): Promise<boolean> {
    const granter = await this.getWithPermissions(granterId);

    if (!granter) {
      return false;
    }

    if (granter.isAdmin) {
      return true;
    }

    const granterPermissions = granter.permissions.map(p => p.permission);
    return permissions.every(p => granterPermissions.includes(p));
  }

  /**
   * Create a new API user with permissions
   */
  async createWithPermissions(data: {
    name: string;
    contact: string;
    department?: string;
    isAdmin: boolean;
    permissions: PermissionType[];
    createdById?: string;
  }): Promise<{ apiUser: ApiUserWithPermissions; plaintextKey: string }> {
    const plaintextKey = generateApiKey();
    const keyHash = hashApiKey(plaintextKey);

    const apiUser = await this.prisma.apiUser.create({
      data: {
        name: data.name,
        contact: data.contact,
        department: data.department,
        keyHash,
        isAdmin: data.isAdmin,
        createdById: data.createdById,
        permissions: {
          create: data.permissions.map(permission => ({
            permission,
          })),
        },
      },
      include: {
        permissions: true,
      },
    });

    logger.info(
      {
        apiUserId: apiUser.id,
        name: data.name,
        isAdmin: data.isAdmin,
        permissions: data.permissions,
        createdBy: data.createdById,
      },
      "Created new API user with permissions"
    );

    return {
      apiUser,
      plaintextKey,
    };
  }
}
