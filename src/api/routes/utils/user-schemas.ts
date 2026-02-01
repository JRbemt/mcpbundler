/**
 * User Schemas - Zod schemas for user endpoints
 *
 * Request and response schemas for user management endpoints.
 */

import { z } from "zod";
import { PermissionType } from "@prisma/client";

/**
 * Base user schema for shared fields
 */
export const BaseUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact: z.string(),
  department: z.string().nullable(),
  isAdmin: z.boolean().optional(),
});

/**
 * Response schemas
 */
export const UserResponseSchema = BaseUserSchema.extend({
  isAdmin: z.boolean(),
  permissions: z.array(z.nativeEnum(PermissionType)),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  updatedAt: z.date(),
  createdById: z.string().nullable(),
  createdBy: z.object({
    name: z.string(),
    id: z.string(),
  }).optional().nullable(),
});

export const UserResponseWithCreatedUsersSchema = UserResponseSchema.extend({
  createdUsers: z.array(UserResponseSchema),
});

/**
 * Request schemas
 */
export const CreateUserRequestSchema = z.object({
  name: z.string().min(1, "Name is required and cannot be empty"),
  contact: z.email("Valid email address required"),
  department: z.string().optional(),
  permissions: z.array(z.nativeEnum(PermissionType)).optional().default([]),
  isAdmin: z.boolean().optional().default(false),
});

export const UpdateUserRequestSchema = BaseUserSchema.omit({
  id: true,
}).partial();

export const CreateUserResponseSchema = UserResponseSchema.extend({
  apiKey: z.string(),
});

export const DeleteUserResponseSchema = z.object({
  userId: z.string(),
});

export const DeleteAllUsersResponseSchema = z.object({
  total: z.number(),
  users: z.array(DeleteUserResponseSchema),
});

/**
 * Type exports
 */
export type BaseUser = z.infer<typeof BaseUserSchema>;
export type User = z.infer<typeof UserResponseSchema>;
export type UserResponse = z.infer<typeof UserResponseSchema>;
export type UserResponseWithCreatedUsers = z.infer<typeof UserResponseWithCreatedUsersSchema>;
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;
export type DeleteUserResponse = z.infer<typeof DeleteUserResponseSchema>;
export type DeleteAllUsersResponse = z.infer<typeof DeleteAllUsersResponseSchema>;
