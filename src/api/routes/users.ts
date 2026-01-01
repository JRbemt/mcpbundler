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

import express, { Request, RequestHandler, Response, Router } from "express";
import { PrismaClient, PermissionType } from "@prisma/client";
import logger from "../../utils/logger.js";
import { ApiUserRepository, GlobalSettingsRepository } from "../database/repositories/index.js";
import { hasPermission, isAdmin } from "../middleware/auth.js";
import { auditApiLog, AuditApiAction } from "../../utils/audit-log.js";
import { z } from "zod";
import { sendZodError } from "./utils/error-formatter.js";
import { ErrorResponse } from "./utils/schemas.js";


export const BaseUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact: z.string(),
  department: z.string().nullable(),
  isAdmin: z.boolean().optional(),
})

/**
 * Request/Response schemas for user endpoints
 */
export const UserResponseSchema = BaseUserSchema.extend({
  isAdmin: z.boolean(),
  permissions: z.array(z.enum(PermissionType)),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  updatedAt: z.date(),
  createdById: z.string().nullable(),
  createdBy: z.object({
    name: z.string(),
    id: z.string()
  }).optional().nullable()
});

const UserResponseWithCreatedUsersSchema = UserResponseSchema.extend({
  createdUsers: z.array(UserResponseSchema),
});

const CreateUserRequestSchema = z.object({
  name: z.string().min(1, "Name is required and cannot be empty"),
  contact: z.email("Valid email address required"),
  department: z.string().optional(),
  permissions: z.array(z.enum(PermissionType)).optional().default([]),
  isAdmin: z.boolean().optional().default(false),
});

const CreateUserResponseSchema = UserResponseSchema.extend({
  apiKey: z.string(),
});

const UpdateUserRequestSchema = BaseUserSchema.omit({
  id: true,
}).partial()



const DeleteUserResponseSchema = z.object({
  userId: z.string(),
});

const DeleteAllUsersResponseSchema = z.object({
  total: z.number(),
  users: z.array(DeleteUserResponseSchema),
});


export type BaseUser = z.infer<typeof BaseUserSchema>;
export type User = z.infer<typeof UserResponseSchema>;
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export type UserResponse = z.infer<typeof UserResponseSchema>;
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;
export type UserResponseWithCreatedUsers = z.infer<typeof UserResponseWithCreatedUsersSchema>;
export type DeleteUserResponse = z.infer<typeof DeleteUserResponseSchema>;
export type DeleteAllUsersResponse = z.infer<typeof DeleteAllUsersResponseSchema>;



export function createUserRoutes(authMiddleware: RequestHandler, prisma: PrismaClient): Router {
  const router = express.Router();
  const apiUserRepo = new ApiUserRepository(prisma);
  const settingsRepo = new GlobalSettingsRepository(prisma);

  /**
   * POST /api/users/self
   * Self-service user creation (no authentication required)
   */
  router.post('/self', async (req: Request<{}, UserResponse | ErrorResponse, CreateUserRequest>, res: Response<UserResponse | ErrorResponse>): Promise<void> => {
    try {
      const settings = await settingsRepo.get();

      if (!settings.allowSelfServiceRegistration) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: "Self-service registration is disabled",
        }, req);

        res.status(403).json({
          error: "Self-service registration disabled",
          message: "Self-service user registration is currently disabled",
        });
        return;
      }

      const validatedData = CreateUserRequestSchema.parse(req.body);

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

      res.status(201).json(UserResponseSchema.strip().parse(apiUser));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error({
          endpoint: "POST /api/users/self",
          error: error.issues,
          receivedData: req.body,
        }, "Validation failed: missing or invalid parameters");
        sendZodError(res, error, "Invalid user registration data");
        return;
      }

      logger.error({ error: error.message }, "Failed to create self-service user");
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  router.use(authMiddleware);

  /**
   * POST /api/users
   * Create a new user (requires authentication and CREATE_USER permission)
   */
  router.post('/', async (req: Request<{}, CreateUserResponse | ErrorResponse, CreateUserRequest>, res: Response<CreateUserResponse | ErrorResponse>): Promise<void> => {
    if (!hasPermission(req, PermissionType.CREATE_USER)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: "Insufficient permissions to create user",
      }, req);

      res.status(403).json({
        error: "Insufficient permissions",
        message: "CREATE_USER permission required",
      });
      return;
    }

    try {
      const validatedData = CreateUserRequestSchema.parse(req.body);

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

      if (validatedData.isAdmin && !isAdmin(req)) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: "Non-admin cannot create admin users",
        }, req);

        res.status(403).json({
          error: "Cannot create admin",
          message: "Only admins can create admin users",
        });
        return;
      }

      const { apiUser, plaintextKey } = await apiUserRepo.createWithPermissions({
        ...validatedData,
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

      res.status(201).json(CreateUserResponseSchema.strip().parse({
        ...apiUser,
        apiKey: plaintextKey,
      }));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error({
          endpoint: "POST /api/users",
          error: error.issues,
          receivedData: req.body,
        }, "Validation failed: missing or invalid parameters");
        sendZodError(res, error, "Invalid user creation data");
        return;
      }

      logger.error({ error: error.message, userId: req.apiAuth?.userId }, "Failed to create user");
      res.status(500).json({ error: "Failed to create user" });
    }
  });

  /**
   * GET /api/users/me
   * Get own user profile with all users created by this user
   */
  router.get('/me', async (req: Request, res: Response<UserResponseWithCreatedUsers | ErrorResponse>): Promise<void> => {
    try {
      const user = await apiUserRepo.getWithPermissions(req.apiAuth!.userId);

      if (!user) {
        auditApiLog({
          action: AuditApiAction.USER_VIEW,
          success: false,
          errorMessage: "User not found",
          details: { userId: req.apiAuth!.userId },
        }, req);

        res.status(404).json({ error: "User not found" });
        return;
      }

      // Get all users created by this user
      const createdUsers = await apiUserRepo.getCreatedUsers(req.apiAuth!.userId);

      auditApiLog({
        action: AuditApiAction.USER_VIEW,
        success: true,
        details: { userId: user.id, createdUsersCount: createdUsers.length },
      }, req);

      res.json(
        UserResponseWithCreatedUsersSchema.strip().parse({
          ...user,
          permissions: user.permissions.map(p => p.permission),
          createdUsers: createdUsers.map(u => ({
            ...u,
            permissions: u.permissions.map(p => p.permission)
          }))
        })
      );
    } catch (error: any) {
      auditApiLog({
        action: AuditApiAction.USER_VIEW,
        success: false,
        errorMessage: error.message,
        details: { userId: req.apiAuth?.userId },
      }, req);

      logger.error({ error: error.message, userId: req.apiAuth?.userId }, "Failed to get user profile");
      res.status(500).json({ error: "Failed to get user profile" });
    }
  });

  /**
   * PUT /api/users/me
   * Update own user profile
   */
  router.put('/me', async (req: Request<{}, BaseUser | ErrorResponse, UpdateUserRequest>, res: Response<BaseUser | ErrorResponse>): Promise<void> => {
    try {
      const validatedData = UpdateUserRequestSchema.parse(req.body);
      const user = await apiUserRepo.update(req.apiAuth!.userId, validatedData);
      auditApiLog({
        action: AuditApiAction.USER_UPDATE,
        success: true,
        details: { userId: user.id, updates: Object.keys(validatedData) },
      }, req);
      res.json(BaseUserSchema.strip().parse(user));

    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error({
          endpoint: "PUT /api/users/me",
          userId: req.apiAuth?.userId,
          error: error.issues,
          receivedData: req.body,
        }, "Validation failed: missing or invalid parameters");
        sendZodError(res, error, "Invalid user update data");
        return;
      }

      logger.error({ error: error.message, userId: req.apiAuth?.userId }, "Failed to update user");
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  /**
   * POST /api/users/me/revoke
   * Revoke own API key
   */
  router.post('/me/revoke', async (req: Request, res: Response<DeleteUserResponse | ErrorResponse>): Promise<void> => {
    try {
      const user = await apiUserRepo.revoke(req.apiAuth!.userId);

      auditApiLog({
        action: AuditApiAction.USER_REVOKE,
        success: true,
        details: { userId: user.id },
      }, req);

      res.json(DeleteUserResponseSchema.strip().parse({ userId: user.id }));
    } catch (error: any) {
      logger.error({ error: error.message, userId: req.apiAuth?.userId }, "Failed to revoke API key");
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  });

  /**
   * POST /api/users/:userId/revoke
   * Revoke a user created by the current user (and cascade to all users they created)
   */
  router.post('/:userId/revoke', async (req: Request<{ userId: string }>, res: Response<DeleteAllUsersResponse | ErrorResponse>): Promise<void> => {
    try {
      const targetUserId = req.params.userId;

      // Verify the target user exists and was created by the current user
      const targetUser = await apiUserRepo.getWithPermissions(targetUserId);

      if (!targetUser) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      if (targetUser.createdById !== req.apiAuth!.userId) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: "Cannot revoke user not created by you",
          details: { targetUserId, actualCreator: targetUser.createdById },
        }, req);

        res.status(403).json({
          error: "Cannot revoke this user",
          message: "You can only revoke users you created",
        });
        return;
      }

      if (targetUser.revokedAt) {
        res.status(400).json({ error: "User already revoked" });
        return;
      }

      // Recursively revoke user and all descendants
      const revokedUserIds = await apiUserRepo.revokeUserCascade(targetUserId);

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

      res.json(DeleteAllUsersResponseSchema.parse({
        total: revokedUserIds.length,
        users: revokedUserIds.map(id => ({ userId: id })),
      }));
    } catch (error: any) {
      logger.error({ error: error.message, userId: req.apiAuth?.userId, targetUserId: req.params.userId }, "Failed to revoke created user");
      res.status(500).json({ error: "Failed to revoke user" });
    }
  });

  /**
   * POST /api/users/me/revoke-all
   * Revoke ALL users created by the current user (and all their descendants)
   */
  router.post('/me/revoke-all', async (req: Request, res: Response<DeleteAllUsersResponse | ErrorResponse>): Promise<void> => {
    try {
      // Find all users created by the current user
      const createdUsers = await apiUserRepo.getNonRevokedCreatedUsers(req.apiAuth!.userId);

      if (createdUsers.length === 0) {
        res.status(400).json({
          error: "No users to revoke",
          message: "You have no active users to revoke"
        });
        return;
      }

      const allRevokedIds: string[] = [];

      // Revoke each user and their descendants
      for (const user of createdUsers) {
        const revokedIds = await apiUserRepo.revokeUserCascade(user.id);
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

      res.json(DeleteAllUsersResponseSchema.strip().parse({
        total: allRevokedIds.length,
        users: allRevokedIds.map(id => ({ userId: id })),
      }));
    } catch (error: any) {
      logger.error({ error: error.message, userId: req.apiAuth?.userId }, "Failed to revoke all created users");
      res.status(500).json({ error: "Failed to revoke users" });
    }
  });

  /**
   * GET /api/users
   * List all users (requires LIST_USERS permission or admin)
   */
  router.get('/', async (req: Request, res: Response<UserResponse[] | ErrorResponse>): Promise<void> => {
    if (!hasPermission(req, PermissionType.LIST_USERS)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: "Insufficient permissions to list users",
      }, req);

      res.status(403).json({
        error: "Insufficient permissions",
        message: "LIST_USERS permission or admin required",
      });
      return;
    }

    try {
      const includeRevoked = req.query.include_revoked === "true";
      const users = await apiUserRepo.list({ includeRevoked });

      res.json(z.array(UserResponseSchema).parse(users.map(user => UserResponseSchema.strip().parse(user))));
    } catch (error: any) {
      logger.error({ error: error.message, userId: req.apiAuth?.userId }, "Failed to list users");
      res.status(500).json({ error: "Failed to list users" });
    }
  });

  /**
   * GET /api/users/by-name/:name
   * Get user by name (admin only)
   */
  router.get('/by-name/:name', async (req: Request<{ name: string }>, res: Response<UserResponse | ErrorResponse>): Promise<void> => {
    try {
      const user = await apiUserRepo.findByName(req.params.name);

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const userWithPerms = await apiUserRepo.getWithPermissions(user.id);

      res.json(UserResponseSchema.strip().parse(userWithPerms));
    } catch (error: any) {
      logger.error({ error: error.message, userName: req.params.name, userId: req.apiAuth?.userId }, "Failed to get user by name");
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  /**
   * POST /api/users/by-name/:name/revoke
   * Revoke user by name (admin only)
   */
  router.post('/by-name/:name/revoke', async (req: Request<{ name: string }>, res: Response<DeleteUserResponse | ErrorResponse>): Promise<void> => {
    if (!isAdmin(req)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: "Admin required to revoke users",
      }, req);

      res.status(403).json({
        error: "Admin required",
        message: "Only admins can revoke other users",
      });
      return;
    }

    try {
      const user = await apiUserRepo.findByName(req.params.name);

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const revokedUser = await apiUserRepo.revoke(user.id);

      auditApiLog({
        action: AuditApiAction.USER_REVOKE,
        success: true,
        details: { userId: revokedUser.id, revokedBy: req.apiAuth!.userId },
      }, req);

      res.json(DeleteUserResponseSchema.strip().parse({ userId: revokedUser.id }));
    } catch (error: any) {
      logger.error({ error: error.message, userName: req.params.name, userId: req.apiAuth?.userId }, "Failed to revoke user");
      res.status(500).json({ error: "Failed to revoke user" });
    }
  });

  return router;
}
