import express, { Request, Response, Router } from 'express';
import { PrismaClient, PermissionType } from '@prisma/client';
import logger from '../../utils/logger.js';
import { ApiKeyRepository } from '../database/repositories/index.js';
import { hasPermission, isAdmin } from '../middleware/auth.js';
import { auditApiLog, AuditApiAction } from '../../utils/audit-log.js';
import { z } from 'zod';
import { sendZodError } from '../../utils/error-formatter.js';

export function createPermissionRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const apiUserRepo = new ApiKeyRepository(prisma);

  const AddPermissionSchema = z.object({
    permission: z.nativeEnum(PermissionType),
    propagate: z.boolean().optional().default(false),
  });

  /**
   * GET /api/permissions/types
   * List all available permission types (public endpoint)
   */
  router.get('/', async (req: Request, res: Response) => {
    res.json({
      permissions: Object.values(PermissionType),
      descriptions: {
        CREATE_USER: 'Allows creating new users with permissions they possess',
        ADD_MCP: 'Allows adding new MCPs to the system',
        LIST_USERS: 'Allows listing all users in the system',
      },
    });
  });

  /**
   * GET /api/permissions/me
   * Get own permissions
   */
  router.get('/me', async (req: Request, res: Response) => {
    if (!req.apiAuth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const user = await apiUserRepo.getWithPermissions(req.apiAuth.userId);

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({
        user_id: user.id,
        user_name: user.name,
        is_admin: user.isAdmin,
        permissions: user.permissions.map(p => p.permission),
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get user permissions');
      res.status(500).json({ error: 'Failed to get permissions' });
    }
  });

  /**
   * GET /api/users/by-name/:name/permissions
   * Get permissions for a specific user by name (admin only)
   */
  router.get('/by-name/:name', async (req: Request, res: Response) => {
    if (!req.apiAuth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!isAdmin(req)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Admin required to view other user permissions',
      }, req);

      res.status(403).json({
        error: 'Admin required',
        message: 'Only admins can view other users\' permissions',
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
        user_id: userWithPerms!.id,
        user_name: userWithPerms!.name,
        is_admin: userWithPerms!.isAdmin,
        permissions: userWithPerms!.permissions.map(p => ({
          id: p.id,
          permission: p.permission,
        })),
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get user permissions');
      res.status(500).json({ error: 'Failed to get permissions' });
    }
  });

  /**
   * POST /api/users/by-name/:name/permissions
   * Add permission to user (requires granter to have the permission)
   */
  router.post('/by-name/:name', async (req: Request, res: Response) => {
    if (!req.apiAuth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const validatedData = AddPermissionSchema.parse(req.body);

      const targetUser = await apiUserRepo.findByName(req.params.name);

      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const canGrant = await apiUserRepo.canGrantPermissions(
        req.apiAuth.userId,
        [validatedData.permission]
      );

      if (!canGrant) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Cannot grant permission user does not possess',
          details: { requestedPermission: validatedData.permission },
        }, req);

        res.status(403).json({
          error: 'Cannot grant permission',
          message: 'You can only grant permissions you currently have',
        });
        return;
      }

      const affectedCount = await apiUserRepo.addPermission(
        targetUser.id,
        validatedData.permission,
        req.apiAuth.userId,
        validatedData.propagate
      );

      auditApiLog({
        action: AuditApiAction.PERMISSION_ADD,
        success: true,
        details: {
          targetUserId: targetUser.id,
          targetUserName: targetUser.name,
          permission: validatedData.permission,
          grantedBy: req.apiAuth.userId,
          propagate: validatedData.propagate,
          affectedUsers: affectedCount,
        },
      }, req);

      res.status(201).json({
        message: validatedData.propagate
          ? `Permission added successfully and cascaded to ${affectedCount} user(s)`
          : 'Permission added successfully',
        user: {
          id: targetUser.id,
          name: targetUser.name,
        },
        permission: validatedData.permission,
        affected_users: affectedCount,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        sendZodError(res, error, "Invalid request data");
        return;
      }

      logger.error({ error: error.message }, 'Failed to add permission');
      res.status(500).json({ error: 'Failed to add permission' });
    }
  });

  /**
   * DELETE /api/users/by-name/:name/permissions/:permission
   * Remove permission from user (cascades to descendants)
   * Non-admins can only revoke permissions they have from users they created
   */
  router.delete('/by-name/:name/:permission', async (req: Request, res: Response) => {
    if (!req.apiAuth) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    try {
      const permission = req.params.permission as PermissionType;

      if (!Object.values(PermissionType).includes(permission)) {
        res.status(400).json({
          error: 'Invalid permission',
          message: `Permission must be one of: ${Object.values(PermissionType).join(', ')}`,
        });
        return;
      }

      const targetUser = await apiUserRepo.findByName(req.params.name);

      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (!isAdmin(req)) {
        const revoker = await apiUserRepo.getWithPermissions(req.apiAuth.userId);

        if (!revoker) {
          res.status(403).json({ error: 'User not found' });
          return;
        }

        const hasPermission = revoker.permissions.some(p => p.permission === permission);
        if (!hasPermission) {
          auditApiLog({
            action: AuditApiAction.AUTH_FAILURE,
            success: false,
            errorMessage: 'Cannot revoke permission user does not possess',
            details: { requestedPermission: permission },
          }, req);

          res.status(403).json({
            error: 'Cannot revoke permission',
            message: 'You can only revoke permissions you currently have',
          });
          return;
        }

        if (targetUser.createdById !== req.apiAuth.userId) {
          auditApiLog({
            action: AuditApiAction.AUTH_FAILURE,
            success: false,
            errorMessage: 'Cannot revoke permission from user you did not create',
            details: { targetUserId: targetUser.id },
          }, req);

          res.status(403).json({
            error: 'Cannot revoke permission',
            message: 'You can only revoke permissions from users you created',
          });
          return;
        }
      }

      const affectedCount = await apiUserRepo.removePermission(targetUser.id, permission);

      auditApiLog({
        action: AuditApiAction.PERMISSION_REMOVE,
        success: true,
        details: {
          targetUserId: targetUser.id,
          targetUserName: targetUser.name,
          permission,
          removedBy: req.apiAuth.userId,
          affectedUsers: affectedCount,
        },
      }, req);

      res.json({
        message: `Permission removed successfully and cascaded to ${affectedCount} user(s)`,
        user: {
          id: targetUser.id,
          name: targetUser.name,
        },
        permission,
        affected_users: affectedCount,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to remove permission');
      res.status(500).json({ error: 'Failed to remove permission' });
    }
  });

  return router;
}
