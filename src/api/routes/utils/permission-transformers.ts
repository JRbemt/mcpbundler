/**
 * Permission Response Transformers
 *
 * Transforms database entities to API response types for permission endpoints.
 * Contains all Zod schemas for permission-related endpoints.
 */

import { z } from "zod";
import { PermissionType } from "@prisma/client";

/**
 * Schema definitions - Request schemas
 */
export const AddPermissionRequestSchema = z.object({
  permissions: z.array(z.nativeEnum(PermissionType)),
  propagate: z.boolean().optional().default(false),
});

export const RemovePermissionRequestSchema = AddPermissionRequestSchema.omit({
  propagate: true,
});

/**
 * Schema definitions - Response schemas
 */
export const PermissionListResponseSchema = z.object({
  permissions: z.array(z.nativeEnum(PermissionType)),
  descriptions: z.record(z.string(), z.string()),
});

export const UserPermissionsResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  isAdmin: z.boolean(),
  permissions: z.array(z.nativeEnum(PermissionType)),
});

export const ChangePermissionResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  permissions: z.array(z.nativeEnum(PermissionType)),
  affectedUsers: z.number(),
});

/**
 * Type exports
 */
export type AddPermissionRequest = z.infer<typeof AddPermissionRequestSchema>;
export type RemovePermissionRequest = z.infer<typeof RemovePermissionRequestSchema>;
export type PermissionListResponse = z.infer<typeof PermissionListResponseSchema>;
export type UserPermissionsResponse = z.infer<typeof UserPermissionsResponseSchema>;
export type ChangePermissionResponse = z.infer<typeof ChangePermissionResponseSchema>;

/**
 * Permission descriptions for listing endpoint
 */
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  CREATE_USER: "Allows creating new users with permissions they possess",
  ADD_MCP: "Allows adding new MCPs to the system",
  LIST_USERS: "Allows listing all users in the system",
  VIEW_PERMISSIONS: "Allows checking other users permissions",
};

/**
 * Transform user with permissions to response format
 */
export function transformUserPermissionsResponse(user: {
  id: string;
  name: string;
  isAdmin: boolean;
  permissions: Array<{ permission: PermissionType }>;
}): UserPermissionsResponse {
  return UserPermissionsResponseSchema.strip().parse({
    id: user.id,
    name: user.name,
    isAdmin: user.isAdmin,
    permissions: user.permissions.map((p) => p.permission),
  });
}

/**
 * Transform permission change result to response format
 */
export function transformChangePermissionResponse(
  user: { id: string; name: string; permissions: Array<{ permission: PermissionType }> },
  newPermissions: PermissionType[],
  affectedUsers: number
): ChangePermissionResponse {
  return ChangePermissionResponseSchema.strip().parse({
    id: user.id,
    name: user.name,
    permissions: newPermissions,
    affectedUsers,
  });
}

/**
 * Transform permission list to response format
 */
export function transformPermissionListResponse(): PermissionListResponse {
  return {
    permissions: Object.values(PermissionType),
    descriptions: PERMISSION_DESCRIPTIONS,
  };
}
