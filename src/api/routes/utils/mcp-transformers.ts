/**
 * MCP Response Transformers
 *
 * Transforms database entities to API response types for MCP endpoints.
 * Contains all Zod schemas for MCP-related endpoints.
 */

import { z } from "zod";
import { MCPAuthConfigSchema, AuthStrategy } from "../../../shared/domain/entities.js";

/**
 * Schema definitions - Request schemas
 */
export const CreateMcpRequestSchema = z.object({
  namespace: z
    .string()
    .min(1)
    .regex(
      /^(?!.*__)([A-Za-z0-9_.-]+)$/,
      "Namespace must contain only letters, digits, underscores, dots, and hyphens (no consecutive underscores)"
    ),
  url: z.url(),
  description: z.string().min(1),
  version: z.string().min(1).default("1.0.0"),
  stateless: z.boolean().default(false),
  authStrategy: z.enum(AuthStrategy).default("NONE"),
  masterAuth: MCPAuthConfigSchema.optional(),
});

export const UpdateMcpRequestSchema = CreateMcpRequestSchema.partial().omit({ namespace: true });

/**
 * Schema definitions - Response schemas
 */
export const MCPResponseSchema = CreateMcpRequestSchema.extend({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
}).omit({
  masterAuth: true,
});

export const BulkDeleteResponseSchema = z.object({
  count: z.number(),
  mcps: z.array(z.string()),
});

/**
 * Type exports
 */
export type CreateMcpRequest = z.infer<typeof CreateMcpRequestSchema>;
export type UpdateMcpRequest = z.infer<typeof UpdateMcpRequestSchema>;
export type McpResponse = z.infer<typeof MCPResponseSchema>;
export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponseSchema>;

/**
 * MCP database entity type for transformers
 */
interface McpEntity {
  id: string;
  namespace: string;
  url: string;
  description: string;
  version: string;
  stateless: boolean;
  authStrategy: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: { id: string; name: string } | null;
}

/**
 * Transform MCP entity to response format
 */
export function transformMcpResponse(mcp: McpEntity): McpResponse {
  return MCPResponseSchema.strip().parse(mcp);
}

/**
 * Transform MCP list to response format
 */
export function transformMcpListResponse(mcps: McpEntity[]): McpResponse[] {
  return mcps.map((m) => MCPResponseSchema.strip().parse(m));
}

/**
 * Transform bulk delete result to response format
 */
export function transformBulkDeleteResponse(
  count: number,
  namespaces: string[]
): BulkDeleteResponse {
  return BulkDeleteResponseSchema.parse({
    deleted: count,
    mcps: namespaces,
  });
}
