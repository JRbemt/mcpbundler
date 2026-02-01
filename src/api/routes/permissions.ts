/**
 * Permission Routes - User permission management
 *
 * The user system is hierarchical. This system supports hierarchical permission revocation.
 *
 * Manages permissions for users. Supports hierarchical
 * permission propagation where granting or revoking can cascade to descendant users.
 * 
 * Supported permission types:
 * - CREATE_USER
 * - ADD_MCP
 * - LIST_USERS
 * - VIEW_PERMISSIONS
 *
 * Endpoints:
 * - GET    /api/permissions                            - List all permission types
 * - GET    /api/permissions/me                         - Get own permissions
 * - GET    /api/permissions/user-id/:id                - Get user permissions (VIEW_PERMISSIONS)
 * - POST   /api/permissions/user-id/:id/add            - Add permissions (optional cascade)
 * - POST   /api/permissions/user-id/:id/remove         - Remove permissions (cascades)
 *
 */

import express, { Request, Response, Router } from "express";
import { PrismaClient, PermissionType } from "@prisma/client";
import { ApiUserRepository } from "../../shared/infra/repository/index.js";
import { hasPermission, isAdmin } from "../middleware/auth.js";
import { validatedHandler, sendNotFound, sendForbidden, validatedBodyHandler } from "./utils/route-utils.js";
import { RequestHandler } from "express-serve-static-core";
import {
  AddPermissionRequestSchema,
  RemovePermissionRequestSchema,
  PermissionListResponseSchema,
  UserPermissionsResponseSchema,
  ChangePermissionResponseSchema,
  PermissionListResponse,
  UserPermissionsResponse,
  ChangePermissionResponse,
  AddPermissionRequest,
  RemovePermissionRequest,
  PERMISSION_DESCRIPTIONS,
} from "./utils/permission-schemas.js";
import { AuditApiAction } from "../../shared/utils/audit-log.js";

// Re-export types for backwards compatibility
export type {
  AddPermissionRequest,
  RemovePermissionRequest,
  PermissionListResponse,
  UserPermissionsResponse,
  ChangePermissionResponse,
};

export function createPermissionRoutes(authMiddleware: RequestHandler, prisma: PrismaClient): Router {
  const router = express.Router();
  const apiUserRepo = new ApiUserRepository(prisma);

  /**
  * GET /api/permissions
  * List all available permission types
  */
  router.get(
    "/",
    validatedHandler(
      PermissionListResponseSchema,
      async () => ({
        permissions: Object.values(PermissionType),
        descriptions: PERMISSION_DESCRIPTIONS,
      }),
      {
        action: AuditApiAction.OTHER,
      }
    )
  );

  router.use(authMiddleware);

  /**
   * GET /api/permissions/me
   * Get own permissions
   */
  router.get(
    "/me",
    validatedHandler(
      UserPermissionsResponseSchema,
      async (req, res) => {
        const user = await apiUserRepo.getWithPermissions(req.apiAuth!.userId);

        if (!user) {
          return sendNotFound(
            res,
            "User",
            req,
            AuditApiAction.USER_VIEW,
            { userId: req.apiAuth!.userId, scope: "permissions" }
          );
        }

        return {
          id: user.id,
          name: user.name,
          isAdmin: user.isAdmin,
          permissions: user.permissions.map(p => p.permission),
        };
      },
      {
        action: AuditApiAction.USER_VIEW,
        errorMessage: "Failed to get permissions",
        getAuditDetails: (req, result) => ({
          userId: req.apiAuth!.userId,
          permissionCount: result?.permissions.length,
          scope: "permissions",
        }),
      }
    )
  );

  /**
   * GET /api/permissions/user-id/:id
   * Get permissions for a specific user
   */
  router.get(
    "/user-id/:id",
    validatedHandler(
      UserPermissionsResponseSchema,
      async (req, res) => {
        if (!hasPermission(req, PermissionType.VIEW_PERMISSIONS)) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "VIEW_PERMISSIONS permission required"
          );
        }

        const user = await apiUserRepo.getWithPermissions(req.params.id);

        if (!user) {
          return sendNotFound(
            res,
            "User",
            req,
            AuditApiAction.USER_VIEW,
            { userId: req.params.id, scope: "permissions" }
          );
        }

        return {
          id: user.id,
          name: user.name,
          isAdmin: user.isAdmin,
          permissions: user.permissions.map(p => p.permission),
        };
      },
      {
        action: AuditApiAction.USER_VIEW,
        errorMessage: "Failed to get permissions",
        getAuditDetails: (req, result) => ({
          userId: req.params.id,
          permissionCount: result?.permissions.length,
        }),
      }
    )
  );

  /**
   * POST /api/permissions/user-id/:id/add
   * Add permission(s) to user
   */
  router.post(
    "/user-id/:id/add",
    ...validatedBodyHandler(
      AddPermissionRequestSchema,
      ChangePermissionResponseSchema,
      async (req, res, data) => {
        const targetUser = await apiUserRepo.getWithPermissions(req.params.id);

        if (!targetUser) {
          return sendNotFound(
            res,
            "User",
            req,
            AuditApiAction.PERMISSION_ADD,
            { targetUserId: req.params.id }
          );
        }

        if (!(await apiUserRepo.canManageUser(req.apiAuth!.userId, targetUser.id))) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "You can only manage permissions for users you created or their descendants",
            { targetUserId: targetUser.id }
          );
        }

        if (!(await apiUserRepo.canGrantPermissions(req.apiAuth!.userId, data.permissions))) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "You can only grant permissions you currently have",
            { requestedPermissions: data.permissions }
          );
        }

        let affectedUsers = 0;
        for (const permission of data.permissions) {
          affectedUsers = Math.max(
            affectedUsers,
            await apiUserRepo.addPermission(
              targetUser.id,
              permission,
              req.apiAuth!.userId,
              data.propagate
            )
          );
        }

        const newPermissions = [
          ...new Set([...targetUser.permissions.map(p => p.permission), ...data.permissions]),
        ];

        return {
          id: targetUser.id,
          name: targetUser.name,
          permissions: newPermissions,
          affectedUsers,
        };
      },
      {
        action: AuditApiAction.PERMISSION_ADD,
        successStatus: 201,
        errorMessage: "Failed to add permission",
        getAuditDetails: (req, result) => ({
          targetUserId: req.params.id,
          addedBy: req.apiAuth!.userId,
          affectedUsers: result?.affectedUsers,
        }),
      }
    )
  );

  /**
   * POST /api/permissions/user-id/:id/remove
   * Remove permission(s) from user (cascades)
   */
  router.post(
    "/user-id/:id/remove",
    ...validatedBodyHandler(
      RemovePermissionRequestSchema,
      ChangePermissionResponseSchema,
      async (req, res, data) => {
        const targetUser = await apiUserRepo.getWithPermissions(req.params.id);

        if (!targetUser) {
          return sendNotFound(
            res,
            "User",
            req,
            AuditApiAction.PERMISSION_REMOVE,
            { targetUserId: req.params.id }
          );
        }

        if (!(await apiUserRepo.canManageUser(req.apiAuth!.userId, targetUser.id))) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "You can only manage permissions for users you created or their descendants",
            { targetUserId: targetUser.id }
          );
        }

        if (!isAdmin(req)) {
          if (!(await apiUserRepo.canGrantPermissions(req.apiAuth!.userId, data.permissions))) {
            return sendForbidden(
              res,
              req,
              AuditApiAction.AUTH_FAILURE,
              "You can only revoke permissions you currently have",
              { requestedPermissions: data.permissions }
            );
          }
        }

        let affectedUsers = 0;
        for (const permission of data.permissions) {
          affectedUsers = Math.max(
            affectedUsers,
            await apiUserRepo.removePermission(targetUser.id, permission)
          );
        }

        const newPermissions = targetUser.permissions
          .map(p => p.permission)
          .filter(p => !data.permissions.includes(p));

        return {
          id: targetUser.id,
          name: targetUser.name,
          permissions: newPermissions,
          affectedUsers,
        };
      },
      {
        action: AuditApiAction.PERMISSION_REMOVE,
        errorMessage: "Failed to remove permissions",
        getAuditDetails: (req, result) => ({
          targetUserId: req.params.id,
          removedBy: req.apiAuth!.userId,
          affectedUsers: result?.affectedUsers,
        }),
      }
    )
  );

  return router;
}
