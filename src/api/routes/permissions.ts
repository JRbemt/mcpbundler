/**
 * Permission Routes - User permission management
 *
 * The user system is hierarchical. This system supports hierarchical permission revocation.
 *
 * Manages permissions for users. Supports hierarchical
 * permission propagation where granting or revoking can cascade to descendant users.
 *
 * Endpoints:
 * - GET    /api/permissions                            - List all permission types
 * - GET    /api/permissions/me                         - Get own permissions
 * - GET    /api/permissions/by-id/:id                  - Get user permissions (VIEW_PERMISSIONS)
 * - POST   /api/permissions/by-id/:id/add              - Add permissions (optional cascade)
 * - POST   /api/permissions/by-id/:id/remove           - Remove permissions (cascades)
 *
 * Permission types: CREATE_USER, ADD_MCP, LIST_USERS, VIEW_PERMISSIONS. Users can
 * only grant permissions they possess. Revocations always cascade. Admins bypass all.
 */

import express, { Request, Response, Router } from "express";
import { PrismaClient, PermissionType } from "@prisma/client";
import logger from "../../utils/logger.js";
import { ApiUserRepository } from "../database/repositories/index.js";
import { hasPermission, isAdmin } from "../middleware/auth.js";
import { auditApiLog, AuditApiAction } from "../../utils/audit-log.js";
import { z } from "zod";
import { sendZodError } from "./utils/error-formatter.js";
import { RequestHandler } from "express-serve-static-core";
import { ErrorResponse } from "./utils/schemas.js";
import { permission } from "node:process";
/**
 * Request/Response schemas for permission endpoints
 */

const AddPermissionRequestSchema = z.object({
  permissions: z.array(z.enum(PermissionType)),
  propagate: z.boolean().optional().default(false),
});

const PermissionListResponseSchema = z.object({
  permissions: z.array(z.enum(PermissionType)),
  descriptions: z.record(z.string(), z.string()),
});

const UserPermissionsResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
  permissions: z.array(z.enum(PermissionType)),
});

const ChangePermissionResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.enum(PermissionType)),
  affectedUsers: z.number(),
});

const RemovePermissionRequestSchema = AddPermissionRequestSchema.omit({
  propagate: true
});


export type AddPermissionRequest = z.infer<typeof AddPermissionRequestSchema>;
export type RemovePermissionRequest = z.infer<typeof RemovePermissionRequestSchema>;
export type PermissionListResponse = z.infer<typeof PermissionListResponseSchema>;
export type UserPermissionsResponse = z.infer<typeof UserPermissionsResponseSchema>;
export type ChangePermissionResponse = z.infer<typeof ChangePermissionResponseSchema>;

export function createPermissionRoutes(authMiddleware: RequestHandler, prisma: PrismaClient): Router {
  const router = express.Router();
  const apiUserRepo = new ApiUserRepository(prisma);

  /*
  * GET /api/permissions
  * List all available permission types
  */
  router.get('/', async (req: Request, res: Response<PermissionListResponse>): Promise<void> => {
    res.json({
      permissions: Object.values(PermissionType),
      descriptions: {
        CREATE_USER: "Allows creating new users with permissions they possess",
        ADD_MCP: "Allows adding new MCPs to the system",
        LIST_USERS: "Allows listing all users in the system",
        VIEW_PERMISSIONS: "Allows checking other users permissions"
      },
    });
  });

  router.use(authMiddleware);

  /**
   * GET /api/permissions/me
   * Get own permissions
   */
  router.get('/me', async (req: Request, res: Response<UserPermissionsResponse | ErrorResponse>): Promise<void> => {
    try {
      const user = await apiUserRepo.getWithPermissions(req.apiAuth!.userId);

      if (!user) {
        auditApiLog({
          action: AuditApiAction.USER_VIEW,
          success: false,
          errorMessage: "User not found",
          details: { userId: req.apiAuth!.userId, scope: "permissions" },
        }, req);

        res.status(404).json({ error: "User not found" });
        return;
      }

      auditApiLog({
        action: AuditApiAction.USER_VIEW,
        success: true,
        details: { userId: user.id, permissionCount: user.permissions.length, scope: "permissions" },
      }, req);

      res.json({
        id: user.id,
        name: user.name,
        isAdmin: user.isAdmin,
        permissions: user.permissions.map(p => p.permission),
      });
    } catch (error: any) {
      auditApiLog({
        action: AuditApiAction.USER_VIEW,
        success: false,
        errorMessage: error.message,
        details: { userId: req.apiAuth!.userId, scope: "permissions" },
      }, req);

      logger.error({ error: error.message, userId: req.apiAuth!.userId }, "Failed to get user permissions");
      res.status(500).json({ error: "Failed to get permissions" });
    }
  });

  /**
   * GET /api/permissions/by-id/:id
   * Get permissions for a specific user by id
   */
  router.get('/by-id/:id', async (req: Request<{ id: string }>, res: Response<UserPermissionsResponse | ErrorResponse>): Promise<void> => {

    if (!hasPermission(req, PermissionType.VIEW_PERMISSIONS)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: "Insufficient permissions to view permissions",
      }, req);

      res.status(403).json({
        error: "Insufficient permissions",
        message: "VIEW_PERMISSIONS permission required",
      });
      return;
    }

    try {
      const userWithPerms = await apiUserRepo.getWithPermissions(req.params.id);

      if (!userWithPerms) {
        auditApiLog({
          action: AuditApiAction.USER_VIEW,
          success: false,
          errorMessage: "User not found",
          details: { userId: req.params.id, scope: "permissions" },
        }, req);

        res.status(404).json({ error: "User not found" });
        return;
      }

      auditApiLog({
        action: AuditApiAction.USER_VIEW,
        success: true,
        details: {
          userId: userWithPerms.id,
          permissionCount: userWithPerms.permissions.length,
        },
      }, req);

      res.json(UserPermissionsResponseSchema.strip().parse({ ...userWithPerms, permissions: userWithPerms.permissions.map((p) => p.permission) }));
    } catch (error: any) {
      auditApiLog({
        action: AuditApiAction.USER_VIEW,
        success: false,
        errorMessage: error.message,
        details: { userId: req.params.id },
      }, req);

      logger.error({ error: error.message, userId: req.params.id }, "Failed to get user permissions");
      res.status(500).json({ error: "Failed to get permissions" });
    }
  });

  /**
   * POST /api/permissions/by-id/:id/add
   * Add permission to user (requires granter to have the permission)
   * 
   * TODO: user is queried twich (optimize query usage)
   */
  router.post('/by-id/:id/add', async (req: Request<{ id: string }, ChangePermissionResponse | ErrorResponse, AddPermissionRequest>, res: Response<ChangePermissionResponse | ErrorResponse>): Promise<void> => {
    try {
      const validatedData = AddPermissionRequestSchema.parse(req.body);

      const targetUser = await apiUserRepo.getWithPermissions(req.params.id);

      if (!targetUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Check hierarchical relationship - can only manage descendants
      const canManage = await apiUserRepo.canManageUser(req.apiAuth!.userId, req.params.id);

      if (!canManage) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: "Cannot manage permissions for user outside hierarchy",
          details: { targetUserId: req.params.id },
        }, req);

        res.status(403).json({
          error: "Cannot manage user",
          message: "You can only manage permissions for users you created or their descendants",
        });
        return;
      }

      // Check if granter has the permissions they're trying to grant
      const canGrant = await apiUserRepo.canGrantPermissions(
        req.apiAuth!.userId,
        validatedData.permissions
      );

      if (!canGrant) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: "Cannot grant permissions user does not possess",
          details: { requestedPermissions: validatedData.permissions },
        }, req);

        res.status(403).json({
          error: "Cannot grant permissions",
          message: "You can only grant permissions you currently have",
        });
        return;
      }

      // Add all permissions
      let affectedUsers = 0;
      for (const permission of validatedData.permissions) {
        const affectedCount = await apiUserRepo.addPermission(
          targetUser.id,
          permission,
          req.apiAuth!.userId,
          validatedData.propagate
        );
        affectedUsers = Math.max(affectedUsers, affectedCount);
      }

      auditApiLog({
        action: AuditApiAction.PERMISSION_ADD,
        success: true,
        details: {
          targetUserId: targetUser.id,
          addedBy: req.apiAuth!.userId,
          affectedUsers: affectedUsers,
        },
      }, req);

      res.status(201).json(ChangePermissionResponseSchema.strip().parse({
        ...targetUser,
        permissions: [...new Set([...targetUser.permissions.map((p) => p.permission), ...validatedData.permissions])],
        affectedUsers
      }));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error({
          endpoint: "POST /api/permissions/by-id/:id/add",
          userId: req.params.id,
          error: error.issues,
          receivedData: req.body,
        }, "Validation failed: missing or invalid parameters");
        sendZodError(res, error, "Invalid request data");
        return;
      }

      logger.error({ error: error.message, userId: req.params.id }, "Failed to add permission");
      res.status(500).json({ error: "Failed to add permission" });
    }
  });

  /**
   * POST /api/permissions/by-id/:id/remove
   * Remove permissions from user (cascades to descendants)
   * Non-admins can only revoke permissions they have from users they created
   */
  router.post('/by-id/:id/remove', async (req: Request<{ id: string }, ChangePermissionResponse | ErrorResponse, RemovePermissionRequest>, res: Response<ChangePermissionResponse | ErrorResponse>): Promise<void> => {
    try {
      const validatedData = RemovePermissionRequestSchema.parse(req.body);

      const targetUser = await apiUserRepo.getWithPermissions(req.params.id);

      if (!targetUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Check hierarchical relationship - can only manage descendants
      const canManage = await apiUserRepo.canManageUser(req.apiAuth!.userId, req.params.id);

      if (!canManage) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: "Cannot manage permissions for user outside hierarchy",
          details: { targetUserId: req.params.id },
        }, req);

        res.status(403).json({
          error: "Cannot manage user",
          message: "You can only manage permissions for users you created or their descendants",
        });
        return;
      }

      // Check if revoker has the permissions they're trying to revoke (non-admins only)
      if (!isAdmin(req)) {
        const canRevoke = await apiUserRepo.canGrantPermissions(
          req.apiAuth!.userId,
          validatedData.permissions
        );

        if (!canRevoke) {
          auditApiLog({
            action: AuditApiAction.AUTH_FAILURE,
            success: false,
            errorMessage: "Cannot revoke permissions user does not possess",
            details: { requestedPermissions: validatedData.permissions },
          }, req);

          res.status(403).json({
            error: "Cannot revoke permissions",
            message: "You can only revoke permissions you currently have",
          });
          return;
        }
      }

      // Remove all permissions
      let affectedUsers = 0;
      for (const permission of validatedData.permissions) {
        const affectedCount = await apiUserRepo.removePermission(targetUser.id, permission);
        affectedUsers = Math.max(affectedUsers, affectedCount);
      }

      auditApiLog({
        action: AuditApiAction.PERMISSION_REMOVE,
        success: true,
        details: {
          targetUserId: targetUser.id,
          removedBy: req.apiAuth!.userId,
          affectedUsers: affectedUsers,
        },
      }, req);

      res.json(
        ChangePermissionResponseSchema.strip().parse({
          ...targetUser,
          permissions: targetUser.permissions.map((p) => p.permission).filter(p => !validatedData.permissions.includes(p)),
          affectedUsers
        }));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error({
          endpoint: "POST /api/permissions/by-id/:id/remove",
          userId: req.params.id,
          error: error.issues,
          receivedData: req.body,
        }, "Validation failed: missing or invalid parameters");
        sendZodError(res, error, "Invalid request data");
        return;
      }

      logger.error({ error: error.message, userId: req.params.id }, "Failed to remove permissions");
      res.status(500).json({ error: "Failed to remove permissions" });
    }
  });

  return router;
}
