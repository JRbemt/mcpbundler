/**
 * API User Repository - Management API authentication and authorization
 *
 * Manages API users (also called API keys or admin keys) which are used to authenticate
 * requests to the management REST API. Each API user has a cryptographically generated
 * key stored as a SHA-256 hash, and can be assigned granular permissions.
 * 
 * Hierarchical model:
 * - Users can create other users (createdById relationship)
 * - Users can only grant permissions they themselves possess (or if they're admin)
 * - Permission changes can cascade through the hierarchy
 * - Revoking a creator can affect all their created users
 * 
 * @see schema.prisma
 */

import { PrismaClient, PermissionType, Prisma } from "@prisma/client";
import { Repository } from "../../domain/Repository.js";
import { ApiUser, CreatedApiUser } from "../../domain/entities.js";
import { generateApiKey, encrypt } from "../../utils/encryption.js";
import logger from "../../utils/logger.js";


export class ApiUserRepository implements Repository<ApiUser, "id"> {
  public client: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.client = prisma;
  }


  async create(item: Omit<ApiUser, "id" | "createdAt" | "updatedAt">): Promise<{ record: ApiUser, token: string }> {
    const plaintextKey = generateApiKey();
    const token = encrypt(plaintextKey);

    const record = await this.client.apiUser.create({
      data: { ...item, keyHash: token, createdAt: new Date(), updatedAt: new Date() },
    });

    logger.info({ id: record.id, name: record.name }, "Created new admin API key");

    return {
      record,
      token,
    };

  }


  /**
   * Validate an API key and update lastUsedAt
   *
   * Checks if the key exists and is not revoked, then updates the lastUsedAt timestamp.
   * This is used by authentication middleware to validate incoming requests.
   *
   * @param plaintextKey - Plaintext API key from request (e.g., from Authorization header)
   * @returns API user record if valid, null if not found or revoked
   */
  async validateAndUpdate(plaintextKey: string): Promise<CreatedApiUser | null> {
    const keyHash = encrypt(plaintextKey);
    const record = await this.findByHash(keyHash);

    if (!record) {
      logger.warn("API key not found");
      return null;
    }

    if (record.revokedAt) {
      logger.warn({ apiKeyId: record.id, revokedAt: record.revokedAt }, "Attempted use of revoked API key");
      return null;
    }

    const updatedRecord = await this.client.apiUser.update({
      where: { id: record.id },
      data: { lastUsedAt: new Date() },
      include: {
        permissions: true,
        createdBy: {
          select: {
            id: true,
            name: true,
          }
        },
      }
    });

    return updatedRecord;
  }

  /**
   * Revoke an API key
   */
  async delete(id: string): Promise<void> {
    const apiKey = await this.client.apiUser.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    logger.info({ apiKeyId: id, name: apiKey.name }, "Revoked API key");
  }

  /**
   * Delete an API key permanently
   */
  async hardDelete(id: string): Promise<void> {
    await this.client.apiUser.delete({ where: { id } });
    logger.info({ apiKeyId: id }, "Deleted API key");
  }

  async findById(id: string): Promise<ApiUser | null> {
    return await this.client.apiUser.findUnique({
      where: {
        id,
      }
    });
  }

  async findFirst(field: keyof Omit<ApiUser, "id" | "createdAt">, value: unknown): Promise<ApiUser | null> {
    const record = await this.client.apiUser.findFirst({
      where: { [field]: value } as any,
    });
    return record;
  }

  /**
   * Find API user by name
   */
  async findByName(name: string): Promise<ApiUser | null> {
    return this.findFirst("name", name);
  }

  async findByHash(keyHash: string): Promise<ApiUser | null> {
    return this.findFirst("keyHash", keyHash);
  }


  async update(item: Partial<ApiUser> & { id: string }): Promise<ApiUser> {
    const { id, ...data } = item;
    const record = await this.client.apiUser.update({
      where: { id },
      data: data,
    });
    return record;
  }

  async exists(id: string): Promise<boolean> {
    return this.findById(id) !== null;
  }

  /**
   * Add permission to user and optionally cascade to all descendants
   *
   * Grants a permission to a user. If propagate is true, the permission is also
   * granted to all users created by this user, recursively.
   *
   * @param userId - UUID of the user to grant permission to
   * @param permission - Permission type to grant
   * @param granterId - UUID of the user granting the permission (for audit)
   * @param propagate - If true, grant to all descendants recursively (default: true)
   * @returns Number of users affected (1 if not propagating, more if cascading)
   */
  async addPermission(
    userId: string,
    permission: PermissionType,
    granterId: string,
    propagate: boolean = true
  ): Promise<number> {
    let affectedCount = 0;

    // Add permission to this user
    try {
      await this.client.apiUserPermission.create({
        data: {
          userId,
          permission,
        },
      });
      affectedCount++;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        logger.debug({ userId, permission }, "Permission already exists");
        affectedCount++;
      } else {
        throw error;
      }
    }

    // Cascade to descendants if requested
    if (propagate) {
      const createdUsers = await this.client.apiUser.findMany({
        where: { createdById: userId, revokedAt: null },
        select: { id: true },
      });

      for (const user of createdUsers) {
        const descendantCount = await this.addPermission(user.id, permission, granterId, true);
        affectedCount += descendantCount;
      }
    }

    logger.info(
      { userId, permission, granterId, affectedCount, propagate },
      "Added permission"
    );

    return affectedCount;
  }

  /**
   * Remove permission from user and cascade to all descendants
   *
   * Removes a permission from a user and ALL their descendants recursively.
   * This ensures permission revocation propagates through the hierarchy.
   * Note: Revocation ALWAYS cascades (no propagate parameter).
   *
   * @param userId - UUID of the user to remove permission from
   * @param permission - Permission type to remove
   * @returns Number of users affected (includes all descendants)
   */
  async removePermission(userId: string, permission: PermissionType): Promise<number> {
    let affectedCount = 0;

    // Remove permission from this user
    const result = await this.client.apiUserPermission.deleteMany({
      where: {
        userId,
        permission,
      },
    });

    if (result.count > 0) {
      affectedCount++;
    }

    // Always cascade to descendants
    const createdUsers = await this.client.apiUser.findMany({
      where: { createdById: userId, revokedAt: null },
      select: { id: true },
    });

    for (const user of createdUsers) {
      const descendantCount = await this.removePermission(user.id, permission);
      affectedCount += descendantCount;
    }

    logger.info(
      { userId, permission, affectedCount },
      "Removed permission with cascade"
    );

    return affectedCount;
  }

  async getWithPermissions(id: string): Promise<CreatedApiUser | null> {
    return this.client.apiUser.findUnique({
      where: { id },
      include: {
        permissions: true,
        createdBy: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Check if user can manage another user (hierarchical relationship check)
   *
   * Validates that a user has authority to manage another user's permissions.
   * User can manage another user if:
   * - They are an admin (unrestricted access)
   * - They created the target user directly
   * - They are an ancestor of the target user (created the creator, etc.)
   *
   * @param managerId - UUID of the user attempting to manage
   * @param targetUserId - UUID of the user being managed
   * @returns True if manager can manage target user, false otherwise
   */
  async canManageUser(managerId: string, targetUserId: string): Promise<boolean> {
    // Can't manage yourself through this method
    if (managerId === targetUserId) {
      return false;
    }

    const manager = await this.getWithPermissions(managerId);

    if (!manager) {
      return false;
    }

    // Admins can manage anyone
    if (manager.isAdmin) {
      return true;
    }

    // Check if target user exists
    const targetUser = await this.client.apiUser.findUnique({
      where: { id: targetUserId },
      select: { createdById: true },
    });

    if (!targetUser || !targetUser.createdById) {
      return false;
    }

    // Check if manager created the target user directly
    if (targetUser.createdById === manager.id) {
      return true;
    }

    // Check if manager is an ancestor of the target user's creator
    const targetCreatorAncestors = await this.collectAncestorIds(targetUser.createdById);
    return targetCreatorAncestors.includes(manager.id);
  }

  /**
   * Check if granter can grant the specified permissions
   *
   * Validates that a user has the authority to grant permissions to another user.
   * Admins can grant any permission. Non-admins can only grant permissions they possess.
   *
   * @param granterId - UUID of the user attempting to grant permissions
   * @param permissions - Array of permissions to check
   * @returns True if granter can grant all specified permissions, false otherwise
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
   * Recursively collect all descendant user IDs
   */
  async collectDescendantIds(userId: string): Promise<string[]> {
    const createdUsers = await this.client.apiUser.findMany({
      where: { createdById: userId },
      select: { id: true },
    });

    const descendants: string[] = [];

    for (const user of createdUsers) {
      descendants.push(user.id);
      const childDescendants = await this.collectDescendantIds(user.id);
      descendants.push(...childDescendants);
    }

    return descendants;
  }

  /**
   * Recursively collect all ancestor user IDs
   */
  async collectAncestorIds(userId: string): Promise<string[]> {
    const user = await this.client.apiUser.findUnique({
      where: { id: userId },
      select: { createdById: true },
    });

    if (!user || !user.createdById) {
      return [];
    }

    const ancestors: string[] = [user.createdById];
    const parentAncestors = await this.collectAncestorIds(user.createdById);
    ancestors.push(...parentAncestors);

    return ancestors;
  }

  /**
   * Check if user is authorized to access/modify a resource (hierarchical ownership)
   *
   * User is authorized if:
   * - They are an admin (unrestricted access)
   * - They created the resource directly (createdById matches userId)
   * - They are an ancestor of the resource creator (parent, grandparent, etc.)
   *
   * @param userId - UUID of the user attempting access
   * @param resource - Resource object with createdById field (Bundle, MCP, etc.)
   * @returns True if user is authorized, false otherwise
   */
  async isAuthorized(userId: string, resource: { createdById: string | null }): Promise<boolean> {

    const user = await this.client.apiUser.findUnique({
      where: { id: userId },
      select: { isAdmin: true },
    });

    if (user?.isAdmin) {
      return true;
    }

    if (!resource.createdById) {
      return false;
    }

    if (resource.createdById === userId) {
      return true;
    }

    const resourceCreatorAncestors = await this.collectAncestorIds(resource.createdById);
    return resourceCreatorAncestors.includes(userId);
  }

  /**
   * Create a new API user with permissions
   *
   * Creates a new API user and assigns initial permissions in a single transaction.
   * This is the preferred method for creating non-admin users with specific permissions.
   *
   * @param data - User creation data including name, contact, permissions, and creator
   * @returns Object containing the API user record (with permissions) and plaintext key
   */
  async createWithPermissions(
    item: Omit<ApiUser, "id" | "createdAt" | "updatedAt" | "lastUsedAt" | "keyHash">,
    permissions: PermissionType[]
  ): Promise<{ record: CreatedApiUser, key: string }> {
    const key = generateApiKey();
    const keyHash = encrypt(key);

    const record = await this.client.apiUser.create({
      data: {
        ...item,
        keyHash: keyHash,
        permissions: {
          create: Array.from(permissions, permission => ({ permission })),
        },
        createdAt: new Date(),
      },
      include: {
        permissions: true,
        createdBy: {
          select: {
            id: true,
            name: true,
          }
        }
      },
    });

    return {
      record,
      key,
    };
  }

  /**
   * Recursively revoke a user and all users they created (hierarchical cascade)
   *
   * Revokes a user by setting their revokedAt timestamp, then recursively revokes
   * all users created by them. This ensures that when a user is revoked, their
   * entire descendant hierarchy is also revoked.
   *
   * @param userId - UUID of the user to revoke
   * @returns Array of all revoked user IDs (includes user and all descendants)
   */
  async revokeUserCascade(userId: string): Promise<string[]> {
    const revokedIds: string[] = [];

    // Find all users created by this user (non-revoked only)
    const createdUsers = await this.client.apiUser.findMany({
      where: {
        createdById: userId,
        revokedAt: null,
      },
      select: {
        id: true,
      },
    });

    // Recursively revoke all descendants first
    for (const user of createdUsers) {
      const descendantIds = await this.revokeUserCascade(user.id);
      revokedIds.push(...descendantIds);
    }

    // Revoke this user
    await this.client.apiUser.update({
      where: { id: userId },
      data: { revokedAt: new Date() },
    });

    revokedIds.push(userId);

    logger.info(
      { userId, cascadeCount: revokedIds.length },
      "Revoked user with cascade"
    );

    return revokedIds;
  }

  /**
   * Get users created by a specific user
   *
   * Finds all users directly created by the specified user
   * Does not include descendants beyond the immediate children.
   *
   * @param creatorId - UUID of the creator user
   * @param includeRevoked - If true, include revoked users in the result (default: false)
   * @returns Array of non-revoked users created by this user
   */
  async listCreatedUsers(creatorId: string, includeRevoked: boolean = false): Promise<Array<{ id: string; name: string }>> {
    return await this.client.apiUser.findMany({
      where: {
        createdById: creatorId,
        revokedAt: includeRevoked ? null : { not: null },
      },
      select: {
        id: true,
        name: true,
      },
    });
  }

  /**
   * Get users created by a specific user (with permissions)
   *
   * @param creatorId - UUID of the creator user
   * @returns Array of users with permissions created by this user
   */
  async getCreatedUsers(creatorId: string): Promise<CreatedApiUser[]> {
    return await this.client.apiUser.findMany({
      where: {
        createdById: creatorId,
      },
      include: {
        permissions: true,
        createdBy: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Get non-revoked users created by a specific user
   *
   * @param creatorId - UUID of the creator user
   * @returns Array of non-revoked users created by this user
   */
  async getNonRevokedCreatedUsers(creatorId: string): Promise<Array<{ id: string; name: string }>> {
    return await this.client.apiUser.findMany({
      where: {
        createdById: creatorId,
        revokedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    });
  }

  /**
   * List all users
   *
   * @param options - Options for filtering (includeRevoked)
   * @returns Array of all users with permissions
   */
  async list(options?: { includeRevoked?: boolean }): Promise<CreatedApiUser[]> {
    const where = options?.includeRevoked ? {} : { revokedAt: null };
    return await this.client.apiUser.findMany({
      where,
      include: {
        permissions: true,
        createdBy: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Revoke a user (soft delete)
   *
   * @param id - UUID of the user to revoke
   * @returns The revoked user
   */
  async revoke(id: string): Promise<ApiUser> {
    const user = await this.client.apiUser.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    logger.info({ apiKeyId: id, name: user.name }, "Revoked API key");
    return user;
  }
}
