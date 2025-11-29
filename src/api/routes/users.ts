import express, { Request, Response, Router } from 'express';
import { PrismaClient, PermissionType } from '@prisma/client';
import logger from '../../utils/logger.js';
import { ApiUserRepository, GlobalSettingsRepository } from '../database/repositories/index.js';
import { hasPermission, isAdmin } from '../middleware/auth.js';
import { auditApiLog, AuditApiAction } from '../../utils/audit-log.js';
import { z } from 'zod';
import { sendZodError } from '../../utils/error-formatter.js';

/**
 * Recursively revoke a user and all users they created
 * Returns array of all revoked user IDs
 */
async function revokeUserCascade(prisma: PrismaClient, userId: string): Promise<string[]> {
  const revokedIds: string[] = [];

  // Find all users created by this user
  const createdUsers = await prisma.apiUser.findMany({
    where: {
      createdById: userId,
      revokedAt: null, // Only revoke non-revoked users
    },
    select: {
      id: true,
    },
  });

  // Recursively revoke all descendants first
  for (const user of createdUsers) {
    const descendantIds = await revokeUserCascade(prisma, user.id);
    revokedIds.push(...descendantIds);
  }

  // Revoke this user
  await prisma.apiUser.update({
    where: { id: userId },
    data: { revokedAt: new Date() },
  });

  revokedIds.push(userId);

  return revokedIds;
}

export function createUserRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const apiUserRepo = new ApiUserRepository(prisma);
  const settingsRepo = new GlobalSettingsRepository(prisma);

  const CreateUserSchema = z.object({
    name: z.string().min(1),
    contact: z.string().email(),
    department: z.string().optional(),
    permissions: z.array(z.nativeEnum(PermissionType)).optional().default([]),
    isAdmin: z.boolean().optional().default(false),
  });

  const UpdateUserSchema = z.object({
    name: z.string().min(1).optional(),
    contact: z.string().email().optional(),
    department: z.string().optional(),
  });

  /**
   * POST /api/users/self
   * Self-service user creation (no authentication required)
   */
  router.post('/self', async (req: Request, res: Response) => {
    try {
      const settings = await settingsRepo.get();

      if (!settings.allowSelfServiceRegistration) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Self-service registration is disabled',
        }, req);

        res.status(403).json({
          error: 'Self-service registration disabled',
          message: 'Self-service user registration is currently disabled',
        });
        return;
      }

      const validatedData = CreateUserSchema.parse(req.body);

      const { apiUser, plaintextKey } = await apiUserRepo.createWithPermissions({
        name: validatedData.name,
        contact: validatedData.contact,
        department: validatedData.department,
        isAdmin: false,
        permissions: settings.defaultSelfServicePermissions,
      });

      auditApiLog({
        action: AuditApiAction.USER_CREATE,
        success: true,
        details: {
          userId: apiUser.id,
          name: apiUser.name,
          selfService: true,
        },
      }, req);

      res.status(201).json({
        id: apiUser.id,
        name: apiUser.name,
        contact: apiUser.contact,
        department: apiUser.department,
        is_admin: apiUser.isAdmin,
        permissions: apiUser.permissions.map(p => p.permission),
        api_key: plaintextKey,
        created_at: apiUser.createdAt,
        message: 'IMPORTANT: Save this API key - it will not be shown again',
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        sendZodError(res, error, "Invalid request data");
        return;
      }

      logger.error({ error: error.message }, 'Failed to create self-service user');
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  /**
   * POST /api/users
   * Create a new user (requires authentication and CREATE_USER permission)
   */
  router.post('/', async (req: Request, res: Response) => {
    if (!hasPermission(req, PermissionType.CREATE_USER)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Insufficient permissions to create user',
      }, req);

      res.status(403).json({
        error: 'Insufficient permissions',
        message: 'CREATE_USER permission required',
      });
      return;
    }

    try {
      const validatedData = CreateUserSchema.parse(req.body);

      const canGrant = await apiUserRepo.canGrantPermissions(
        req.apiAuth!.userId,
        validatedData.permissions
      );

      if (!canGrant) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Cannot grant permissions user does not possess',
          details: { requestedPermissions: validatedData.permissions },
        }, req);

        res.status(403).json({
          error: 'Cannot grant permissions',
          message: 'You can only grant permissions you currently have',
        });
        return;
      }

      if (validatedData.isAdmin && !isAdmin(req)) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Non-admin cannot create admin users',
        }, req);

        res.status(403).json({
          error: 'Cannot create admin',
          message: 'Only admins can create admin users',
        });
        return;
      }

      const { apiUser, plaintextKey } = await apiUserRepo.createWithPermissions({
        name: validatedData.name,
        contact: validatedData.contact,
        department: validatedData.department,
        isAdmin: validatedData.isAdmin,
        permissions: validatedData.permissions,
        createdById: req.apiAuth!.userId,
      });

      auditApiLog({
        action: AuditApiAction.USER_CREATE,
        success: true,
        details: {
          userId: apiUser.id,
          name: apiUser.name,
          createdBy: req.apiAuth!.userId,
        },
      }, req);

      res.status(201).json({
        id: apiUser.id,
        name: apiUser.name,
        contact: apiUser.contact,
        department: apiUser.department,
        is_admin: apiUser.isAdmin,
        permissions: apiUser.permissions.map(p => p.permission),
        created_by_id: apiUser.createdById,
        api_key: plaintextKey,
        created_at: apiUser.createdAt,
        message: 'IMPORTANT: Save this API key - it will not be shown again',
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        sendZodError(res, error, "Invalid request data");
        return;
      }

      logger.error({ error: error.message }, 'Failed to create user');
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  /**
   * GET /api/users/me
   * Get own user profile with all users created by this user
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const user = await apiUserRepo.getWithPermissions(req.apiAuth!.userId);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // Get all users created by this user
      const createdUsers = await prisma.apiUser.findMany({
        where: {
          createdById: req.apiAuth!.userId
        },
        include: {
          permissions: true
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      res.json({
        id: user.id,
        name: user.name,
        contact: user.contact,
        department: user.department,
        is_admin: user.isAdmin,
        permissions: user.permissions.map(p => p.permission),
        created_at: user.createdAt,
        last_used_at: user.lastUsedAt,
        revoked_at: user.revokedAt,
        created_users: createdUsers.map(u => ({
          id: u.id,
          name: u.name,
          contact: u.contact,
          department: u.department,
          is_admin: u.isAdmin,
          permissions: u.permissions.map(p => p.permission),
          created_at: u.createdAt,
          last_used_at: u.lastUsedAt,
          revoked_at: u.revokedAt,
        }))
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get user profile');
      res.status(500).json({ error: 'Failed to get user profile' });
    }
  });

  /**
   * PUT /api/users/me
   * Update own user profile
   */
  router.put('/me', async (req: Request, res: Response) => {

    try {
      const validatedData = UpdateUserSchema.parse(req.body);

      const user = await apiUserRepo.update(req.apiAuth!.userId, validatedData);

      auditApiLog({
        action: AuditApiAction.USER_UPDATE,
        success: true,
        details: { userId: user.id, updates: Object.keys(validatedData) },
      }, req);

      res.json({
        id: user.id,
        name: user.name,
        contact: user.contact,
        department: user.department,
        is_admin: user.isAdmin,
        updated_at: new Date(),
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        sendZodError(res, error, "Invalid request data");
        return;
      }

      logger.error({ error: error.message }, 'Failed to update user');
      res.status(500).json({ error: 'Failed to update user' });
    }
  });

  /**
   * POST /api/users/me/revoke
   * Revoke own API key
   */
  router.post('/me/revoke', async (req: Request, res: Response) => {
    try {
      const user = await apiUserRepo.revoke(req.apiAuth!.userId);

      auditApiLog({
        action: AuditApiAction.USER_REVOKE,
        success: true,
        details: { userId: user.id },
      }, req);

      res.json({
        message: 'API key revoked successfully',
        revoked_at: user.revokedAt,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to revoke API key');
      res.status(500).json({ error: 'Failed to revoke API key' });
    }
  });

  /**
   * POST /api/users/me/created/:userId/revoke
   * Revoke a user created by the current user (and cascade to all users they created)
   */
  router.post('/me/created/:userId/revoke', async (req: Request, res: Response) => {
    try {
      const targetUserId = req.params.userId;

      // Verify the target user exists and was created by the current user
      const targetUser = await prisma.apiUser.findUnique({
        where: { id: targetUserId }
      });

      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (targetUser.createdById !== req.apiAuth!.userId) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Cannot revoke user not created by you',
          details: { targetUserId, actualCreator: targetUser.createdById },
        }, req);

        res.status(403).json({
          error: 'Cannot revoke this user',
          message: 'You can only revoke users you created',
        });
        return;
      }

      if (targetUser.revokedAt) {
        res.status(400).json({ error: 'User already revoked' });
        return;
      }

      // Recursively revoke user and all descendants
      const revokedUserIds = await revokeUserCascade(prisma, targetUserId);

      auditApiLog({
        action: AuditApiAction.USER_REVOKE,
        success: true,
        details: {
          targetUserId,
          revokedBy: req.apiAuth!.userId,
          cascadeCount: revokedUserIds.length,
          revokedUserIds,
        },
      }, req);

      res.json({
        message: 'User and descendants revoked successfully',
        revoked_user_id: targetUserId,
        total_revoked: revokedUserIds.length,
        revoked_user_ids: revokedUserIds,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to revoke created user');
      res.status(500).json({ error: 'Failed to revoke user' });
    }
  });

  /**
   * POST /api/users/me/created/revoke-all
   * Revoke ALL users created by the current user (and all their descendants)
   */
  router.post('/me/created/revoke-all', async (req: Request, res: Response) => {
    try {
      // Find all users created by the current user
      const createdUsers = await prisma.apiUser.findMany({
        where: {
          createdById: req.apiAuth!.userId,
          revokedAt: null,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (createdUsers.length === 0) {
        res.status(400).json({
          error: 'No users to revoke',
          message: 'You have no active users to revoke'
        });
        return;
      }

      const allRevokedIds: string[] = [];

      // Revoke each user and their descendants
      for (const user of createdUsers) {
        const revokedIds = await revokeUserCascade(prisma, user.id);
        allRevokedIds.push(...revokedIds);
      }

      auditApiLog({
        action: AuditApiAction.USER_REVOKE,
        success: true,
        details: {
          revokedBy: req.apiAuth!.userId,
          revokeAll: true,
          directCount: createdUsers.length,
          totalCount: allRevokedIds.length,
          revokedUserIds: allRevokedIds,
        },
      }, req);

      res.json({
        message: 'All created users and their descendants revoked successfully',
        direct_users_revoked: createdUsers.length,
        total_revoked: allRevokedIds.length,
        revoked_user_ids: allRevokedIds,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to revoke all created users');
      res.status(500).json({ error: 'Failed to revoke users' });
    }
  });

  /**
   * GET /api/users
   * List all users (requires LIST_USERS permission or admin)
   */
  router.get('/', async (req: Request, res: Response) => {
    logger.info({
      path: req.path,
      hasAuth: !!req.apiAuth,
      headers: req.headers
    }, 'GET /api/users endpoint hit');

    if (!hasPermission(req, PermissionType.LIST_USERS)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Insufficient permissions to list users',
      }, req);

      res.status(403).json({
        error: 'Insufficient permissions',
        message: 'LIST_USERS permission or admin required',
      });
      return;
    }

    try {
      const includeRevoked = req.query.include_revoked === 'true';
      const users = await apiUserRepo.list({ includeRevoked });

      res.json(users.map(user => ({
        id: user.id,
        name: user.name,
        contact: user.contact,
        department: user.department,
        is_admin: user.isAdmin,
        created_at: user.createdAt,
        last_used_at: user.lastUsedAt,
        revoked_at: user.revokedAt,
        created_by: user.createdBy?.name,
      })));
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list users');
      res.status(500).json({ error: 'Failed to list users' });
    }
  });

  /**
   * GET /api/users/by-name/:name
   * Get user by name (admin only)
   */
  router.get('/by-name/:name', async (req: Request, res: Response) => {

    if (!isAdmin(req)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Admin required to get user by name',
      }, req);

      res.status(403).json({
        error: 'Admin required',
        message: 'Only admins can look up users by name',
      });
      return;
    }

    try {
      const user = await apiUserRepo.findByName(req.params.name);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const userWithPerms = await apiUserRepo.getWithPermissions(user.id);

      res.json({
        id: userWithPerms!.id,
        name: userWithPerms!.name,
        contact: userWithPerms!.contact,
        department: userWithPerms!.department,
        is_admin: userWithPerms!.isAdmin,
        permissions: userWithPerms!.permissions.map(p => p.permission),
        created_at: userWithPerms!.createdAt,
        last_used_at: userWithPerms!.lastUsedAt,
        revoked_at: userWithPerms!.revokedAt,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get user by name');
      res.status(500).json({ error: 'Failed to get user' });
    }
  });

  /**
   * POST /api/users/by-name/:name/revoke
   * Revoke user by name (admin only)
   */
  router.post('/by-name/:name/revoke', async (req: Request, res: Response) => {
    if (!isAdmin(req)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Admin required to revoke users',
      }, req);

      res.status(403).json({
        error: 'Admin required',
        message: 'Only admins can revoke other users',
      });
      return;
    }

    try {
      const user = await apiUserRepo.findByName(req.params.name);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const revokedUser = await apiUserRepo.revoke(user.id);

      auditApiLog({
        action: AuditApiAction.USER_REVOKE,
        success: true,
        details: { userId: revokedUser.id, revokedBy: req.apiAuth!.userId },
      }, req);

      res.json({
        message: 'User revoked successfully',
        user: {
          id: revokedUser.id,
          name: revokedUser.name,
          revoked_at: revokedUser.revokedAt,
        },
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to revoke user');
      res.status(500).json({ error: 'Failed to revoke user' });
    }
  });

  return router;
}
