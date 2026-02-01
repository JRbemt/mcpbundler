/**
 * User Routes - API user account management
 *
 * Manages API users (admin keys) that authenticate to the management REST API.
 * Supports hierarchical relationships where users can create and manage other users.
 *
 * Endpoints:
 * - GET  /api/users                        - List all users (LIST_USERS permission)
 * - POST /api/users/self                   - Self-service registration (no auth, if enabled)
 * - POST /api/users                        - Create user (CREATE_USER permission)
 * - GET  /api/users/me                     - Get own profile with created users
 * - PUT  /api/users/me                     - Update own profile
 * - POST /api/users/me/revoke              - Revoke own API key
 * - POST /api/users/me/revoke-all          - Revoke all users you created
 * - POST /api/users/:userId/revoke         - Revoke user you created (cascades)
 * - GET  /api/users/by-name/:name          - Get user by name (admin only)
 * - POST /api/users/by-name/:name/revoke   - Revoke user by name (admin only)
 *
 * Features: self-service registration (disabled by default), hierarchical creation
 * with permission inheritance, cascade revocation, SHA-256 hashed keys shown once.
 */

import express, { RequestHandler, Router } from "express";
import { PrismaClient, PermissionType } from "@prisma/client";
import { ApiUserRepository, GlobalSettingsRepository } from "../../shared/infra/repository/index.js";
import { hasPermission, isAdmin } from "../middleware/auth.js";
import { AuditApiAction } from "../../shared/utils/audit-log.js";
import { z } from "zod";
import { validatedHandler, sendForbidden, sendNotFound, sent, validatedBodyHandler } from "./utils/route-utils.js";
import {
  BaseUserSchema,
  UserResponseSchema,
  UserResponseWithCreatedUsersSchema,
  CreateUserRequestSchema,
  CreateUserResponseSchema,
  UpdateUserRequestSchema,
  DeleteUserResponseSchema,
  DeleteAllUsersResponseSchema,
  BaseUser,
  User,
  UserResponse,
  UserResponseWithCreatedUsers,
  CreateUserRequest,
  UpdateUserRequest,
  CreateUserResponse,
  DeleteUserResponse,
  DeleteAllUsersResponse,
} from "./utils/user-schemas.js";

// Re-export schemas and types for backwards compatibility
export {
  BaseUserSchema,
  UserResponseSchema,
};
export type {
  BaseUser,
  User,
  UserResponse,
  UserResponseWithCreatedUsers,
  CreateUserRequest,
  UpdateUserRequest,
  CreateUserResponse,
  DeleteUserResponse,
  DeleteAllUsersResponse,
};



export function createUserRoutes(authMiddleware: RequestHandler, prisma: PrismaClient): Router {
  const router = express.Router();
  const apiUserRepo = new ApiUserRepository(prisma);
  const settingsRepo = new GlobalSettingsRepository(prisma);

  /**
   * POST /api/users/self
   * Self-service registration (no auth)
   */
  router.post(
    "/self",
    ...validatedBodyHandler(
      CreateUserRequestSchema,
      CreateUserResponseSchema,
      async (req, res, data) => {
        const settings = await settingsRepo.get();

        if (!settings.allowSelfServiceRegistration) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "Self-service registration is disabled"
          );
        }

        const { record, key } = await apiUserRepo.createWithPermissions(
          {
            name: data.name,
            contact: data.contact,
            department: data.department ?? null,
            isAdmin: false,
            revokedAt: null,
            createdById: null,
          },
          settings.defaultSelfServicePermissions
        );

        return {
          ...record,
          permissions: record.permissions.map(p => p.permission),
          apiKey: key,
        };
      },
      {
        action: AuditApiAction.USER_CREATE,
        successStatus: 201,
        errorMessage: "Failed to create user",
        getAuditDetails: (_req, result) => ({
          userId: result?.id,
          selfService: true,
        }),
      }
    )
  );

  router.use(authMiddleware);

  /**
   * POST /api/users
   * Create user (CREATE_USER)
   */
  router.post(
    "/",
    ...validatedBodyHandler(
      CreateUserRequestSchema,
      CreateUserResponseSchema,
      async (req, res, data) => {
        if (!hasPermission(req, PermissionType.CREATE_USER)) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "CREATE_USER permission required"
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

        if (data.isAdmin && !isAdmin(req)) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "Only admins can create admin users"
          );
        }

        const { permissions, department, ...userData } = data;

        const { record, key } = await apiUserRepo.createWithPermissions(
          {
            ...userData,
            department: department ?? null,
            revokedAt: null,
            createdById: req.apiAuth!.userId,
          },
          permissions
        );

        return {
          ...record,
          permissions: record.permissions.map(p => p.permission),
          apiKey: key,
        };
      },
      {
        action: AuditApiAction.USER_CREATE,
        successStatus: 201,
        errorMessage: "Failed to create user",
        getAuditDetails: (req, result) => ({
          userId: result?.id,
          createdBy: req.apiAuth!.userId,
        }),
      }
    )
  );

  /**
   * GET /api/users/me
   */
  router.get(
    "/me",
    validatedHandler(
      UserResponseWithCreatedUsersSchema,
      async (req, res) => {
        const user = await apiUserRepo.getWithPermissions(req.apiAuth!.userId);
        if (!user) {
          return sendNotFound(res, "User", req, AuditApiAction.USER_VIEW);
        }

        const createdUsers = await apiUserRepo.getCreatedUsers(user.id);

        return {
          ...user,
          permissions: user.permissions.map(p => p.permission),
          createdUsers: createdUsers.map(u => ({
            ...u,
            permissions: u.permissions.map(p => p.permission),
          })),
        };
      },
      {
        action: AuditApiAction.USER_VIEW,
        errorMessage: "Failed to get user profile",
      }
    )
  );

  /**
   * PUT /api/users/me
   */
  router.put(
    "/me",
    ...validatedBodyHandler(
      UpdateUserRequestSchema,
      BaseUserSchema,
      async (req, _res, data) => {
        const user = await apiUserRepo.update({
          id: req.apiAuth!.userId,
          ...data,
        });
        return user;
      },
      {
        action: AuditApiAction.USER_UPDATE,
        errorMessage: "Failed to update user",
        getAuditDetails: (_req, _res) => ({
          updatedFields: Object.keys(_res ?? {}),
        }),
      }
    )
  );

  /**
   * POST /api/users/me/revoke
   */
  router.post(
    "/me/revoke",
    validatedHandler(
      DeleteUserResponseSchema,
      async (req) => {
        const user = await apiUserRepo.revoke(req.apiAuth!.userId);
        return { userId: user.id };
      },
      {
        action: AuditApiAction.USER_REVOKE,
        errorMessage: "Failed to revoke API key",
      }
    )
  );

  /**
   * POST /api/users/:userId/revoke
   */
  router.post(
    "/:userId/revoke",
    validatedHandler(
      DeleteAllUsersResponseSchema,
      async (req, res) => {
        const target = await apiUserRepo.getWithPermissions(req.params.userId);
        if (!target) {
          return sendNotFound(res, "User", req, AuditApiAction.USER_REVOKE);
        }

        if (target.createdById !== req.apiAuth!.userId) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "You can only revoke users you created"
          );
        }

        if (target.revokedAt) {
          res.status(400).json({ error: "User already revoked" });
          return sent();
        }

        const revokedIds = await apiUserRepo.revokeUserCascade(target.id);

        return {
          total: revokedIds.length,
          users: revokedIds.map(id => ({ userId: id })),
        };
      },
      {
        action: AuditApiAction.USER_REVOKE,
        errorMessage: "Failed to revoke user",
      }
    )
  );

  /**
   * GET /api/users
   */
  router.get(
    "/",
    validatedHandler(
      z.array(UserResponseSchema),
      async (req, res) => {
        if (!hasPermission(req, PermissionType.LIST_USERS)) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.AUTH_FAILURE,
            "LIST_USERS permission required"
          );
        }

        const includeRevoked = req.query.include_revoked === "true";
        const users = await apiUserRepo.list({ includeRevoked });

        return users.map(u => ({
          ...u,
          permissions: u.permissions.map(p => p.permission),
        }));
      },
      {
        action: AuditApiAction.USER_VIEW,
        errorMessage: "Failed to list users",
      }
    )
  );

  /**
   * GET /api/users/by-name/:name
   */
  router.get(
    "/by-name/:name",
    validatedHandler(
      UserResponseSchema,
      async (req, res) => {
        if (!isAdmin(req)) {
          return sendForbidden(res, req, AuditApiAction.AUTH_FAILURE, "Admin required");
        }

        const user = await apiUserRepo.findByName(req.params.name);
        if (!user) {
          return sendNotFound(res, "User", req, AuditApiAction.USER_VIEW);
        }

        const full = await apiUserRepo.getWithPermissions(user.id);
        return {
          ...full!,
          permissions: full!.permissions.map(p => p.permission),
        };
      },
      {
        action: AuditApiAction.USER_VIEW,
        errorMessage: "Failed to get user",
      }
    )
  );

  return router;
}
