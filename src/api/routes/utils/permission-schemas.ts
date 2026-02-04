/**
 * Permission Schemas - Zod schemas for permission endpoints
 *
 * Request and response schemas for permission management endpoints.
 */

import { z } from "zod";
import { PermissionType } from "../../../shared/domain/entities.js";

/**
 * Request schemas
 */
export const AddPermissionRequestSchema = z.object({
  permissions: z.array(z.nativeEnum(PermissionType)),
  propagate: z.boolean().optional().default(false),
});

export const RemovePermissionRequestSchema = AddPermissionRequestSchema.omit({
  propagate: true,
});

/**
 * Response schemas
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
