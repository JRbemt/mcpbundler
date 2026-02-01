/**
 * Bundle Response Transformers
 *
 * Transforms database entities to API response types.
 * Handles permission JSON parsing and schema validation.
 * Contains all Zod schemas for bundle-related endpoints.
 */

import { z } from "zod";
import { CreatedBundle, McpPermissionsSchema } from "../../../shared/domain/entities.js";
import { MCPResponseSchema } from "./mcp-transformers.js";
import { BundleWithMcpsAndCreator } from "../../../shared/infra/repository/BundleRepository.js";

/**
 * Schema definitions - Request schemas
 */
export const CreateBundleRequestSchema = z.object({
  name: z.string().min(1, "Bundle name is required and cannot be empty"),
  description: z.string(),
});

export const GenerateTokenRequestSchema = z.object({
  name: z.string().min(1, "Token name is required and cannot be empty"),
  description: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});

const AddMcpByNamespaceRequestSchema = z.object({
  namespace: z.string().min(1, "Namespace required"),
  permissions: McpPermissionsSchema.optional(),
});

export const AddMcpsByNamespaceRequestSchema = z.union([
  AddMcpByNamespaceRequestSchema,
  z.array(AddMcpByNamespaceRequestSchema).min(1, "At least one MCP required"),
]);

/**
 * Schema definitions - Response schemas
 */
export const BundleCreatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact: z.string().optional(),
  department: z.string().nullable().optional(),
  isAdmin: z.boolean().optional(),
});

export const BundleMcpWithPermissionsSchema = MCPResponseSchema.extend({
  permissions: McpPermissionsSchema,
});

export const BundleResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.date(),
  createdBy: BundleCreatorSchema.nullable(),
  mcps: z.array(BundleMcpWithPermissionsSchema),
});

export const CreateBundleResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.date(),
  createdBy: BundleCreatorSchema.nullable(),
});

export const TokenResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  expiresAt: z.date().nullable(),
  revoked: z.boolean(),
  createdAt: z.date(),
});

export const ListTokenResponseSchema = z.array(TokenResponseSchema);

export const GenerateTokenResponseSchema = TokenResponseSchema.extend({
  token: z.string(),
});

export const AddMcpByNamespaceResponseSchema = z.object({
  added: z.array(MCPResponseSchema),
  errors: z.array(z.object({
    namespace: z.string(),
    reason: z.string(),
  })).optional(),
});

/**
 * Type exports
 */
export type CreateBundleRequest = z.infer<typeof CreateBundleRequestSchema>;
export type GenerateTokenRequest = z.infer<typeof GenerateTokenRequestSchema>;
export type AddMcpsByNamespaceRequest = z.infer<typeof AddMcpsByNamespaceRequestSchema>;

export type BundleResponse = z.infer<typeof BundleResponseSchema>;
export type CreateBundleResponse = z.infer<typeof CreateBundleResponseSchema>;
export type GenerateTokenResponse = z.infer<typeof GenerateTokenResponseSchema>;
export type ListTokenResponse = z.infer<typeof ListTokenResponseSchema>;
export type AddMcpByNamespaceResponse = z.infer<typeof AddMcpByNamespaceResponseSchema>;

/**
 * Transform a bundle with MCPs from database format to API response format
 */
export function transformBundleResponse(bundle: BundleWithMcpsAndCreator): BundleResponse {
  return BundleResponseSchema.parse({
    id: bundle.id,
    name: bundle.name,
    description: bundle.description,
    createdAt: bundle.createdAt,
    createdBy: bundle.createdBy,
    mcps: bundle.mcps.map((entry) => ({
      ...MCPResponseSchema.strip().parse(entry.mcp),
      permissions: {
        allowedTools: JSON.parse(entry.allowedTools),
        allowedResources: JSON.parse(entry.allowedResources),
        allowedPrompts: JSON.parse(entry.allowedPrompts),
      },
    })),
  });
}

/**
 * Transform multiple bundles to API response format
 */
export function transformBundleListResponse(bundles: BundleWithMcpsAndCreator[]): BundleResponse[] {
  return bundles.map(transformBundleResponse);
}

/**
 * Transform a created bundle to response format (no mcps)
 */
export function transformCreateBundleResponse(bundle: CreatedBundle): CreateBundleResponse {
  return CreateBundleResponseSchema.parse({
    id: bundle.id,
    name: bundle.name,
    description: bundle.description,
    createdAt: bundle.createdAt,
    createdBy: bundle.createdBy,
  });
}

/**
 * Transform token list to response format
 */
export function transformTokenListResponse(tokens: Array<{
  id: string;
  name: string;
  description: string | null;
  expiresAt: Date | null;
  revoked: boolean;
  createdAt: Date;
}>): ListTokenResponse {
  return ListTokenResponseSchema.parse(tokens.map((t) => TokenResponseSchema.strip().parse(t)));
}

/**
 * Transform generated token to response format
 */
export function transformGenerateTokenResponse(record: {
  id: string;
  name: string;
  description: string | null;
  expiresAt: Date | null;
  revoked: boolean;
  createdAt: Date;
}, token: string): GenerateTokenResponse {
  return GenerateTokenResponseSchema.strip().parse({ ...record, token });
}
