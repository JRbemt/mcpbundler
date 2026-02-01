/**
 * Credential Schemas - Zod schemas for credential endpoints
 *
 * Request and response schemas for credential management endpoints.
 * Response schemas serve as both validation and transformation.
 */

import { z } from "zod";
import { MCPAuthConfigSchema } from "../../../shared/domain/entities.js";

/**
 * Request schemas
 */
export const BindCredentialRequestSchema = z.object({
  authConfig: MCPAuthConfigSchema,
});

export const UpdateCredentialRequestSchema = z.object({
  authConfig: MCPAuthConfigSchema,
});

/**
 * Response schemas
 */
export const CredentialResponseSchema = z.object({
  credentialId: z.string(),
  mcpNamespace: z.string(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const CredentialListItemSchema = z.object({
  credentialId: z.string(),
  mcpNamespace: z.string(),
  mcpUrl: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const CredentialListResponseSchema = z.array(CredentialListItemSchema);

/** Empty response for DELETE (204 No Content) */
export const EmptyResponseSchema = z.undefined();

/**
 * Type exports
 */
export type BindCredentialRequest = z.infer<typeof BindCredentialRequestSchema>;
export type UpdateCredentialRequest = z.infer<typeof UpdateCredentialRequestSchema>;
export type CredentialResponse = z.infer<typeof CredentialResponseSchema>;
export type CredentialListItem = z.infer<typeof CredentialListItemSchema>;
