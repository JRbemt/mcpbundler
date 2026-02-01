/**
 * MCP Routes - MCP registry management
 *
 * Manages MCP server records. MCPs are global server definitions that can be added
 * to bundles. Each has a unique namespace and one of three auth strategies:
 * MASTER (shared config), USER_SET (per-token credentials), or NONE.
 *
 * Endpoints:
 * - GET    /api/mcps                       - List all MCPs
 * - POST   /api/mcps                       - Add MCP (ADD_MCP permission)
 * - GET    /api/mcps/:namespace            - Get MCP by namespace
 * - PUT    /api/mcps/:namespace            - Update MCP by namespace
 * - DELETE /api/mcps/all                   - Bulk delete all user's MCPs
 * - DELETE /api/mcps/:namespace            - Delete MCP by namespace
 *
 * Deletion uses hierarchical permissions: you can delete MCPs you created or MCPs
 * created by users you created. Deletions cascade to all bundle instances.
 */

import express, { Request, Response, Router } from "express";
import { PrismaClient, PermissionType } from "@prisma/client";
import { McpRepository, ApiUserRepository } from "../../shared/infra/repository/index.js";
import { encryptJSON } from "../../shared/utils/encryption.js";
import { hasPermission } from "../middleware/auth.js";
import { asyncHandler, sendNotFound, sendForbidden, validatedHandler, sent } from "./utils/route-utils.js";
import { ErrorResponse } from "./utils/schemas.js";
import {
  // Request schemas
  CreateMcpRequestSchema,
  UpdateMcpRequestSchema,
  // Response types
  McpResponse,
  BulkDeleteResponse,
  CreateMcpRequest,
  UpdateMcpRequest,
  // Transformers
  transformMcpResponse,
  transformMcpListResponse,
  transformBulkDeleteResponse,
  // Re-export MCPResponseSchema for other modules
  MCPResponseSchema,
} from "./utils/mcp-transformers.js";
import { AuditApiAction } from "../../shared/utils/audit-log.js";
import logger from "../../shared/utils/logger.js";

// Re-export types and schemas for backwards compatibility
export {
  MCPResponseSchema,
};
export type {
  CreateMcpRequest,
  UpdateMcpRequest,
  McpResponse,
  BulkDeleteResponse,
};

export function createMcpRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const mcpRepo = new McpRepository(prisma);
  const userRepo = new ApiUserRepository(prisma);

  /**
   * GET /api/mcps
   * List all MCPs
   */
  router.get(
    "/",
    asyncHandler(
      MCPResponseSchema.array(),
      async () => {
        const mcps = await mcpRepo.listAll();
        return transformMcpListResponse(mcps);
      },
      {
        action: AuditApiAction.MCP_VIEW,
        errorMessage: "Failed to list MCPs",
        getAuditDetails: (_req, result) => ({
          count: result?.length,
        }),
      }
    )
  );

  /**
   * POST /api/mcps
   * Add a new MCP (requires ADD_MCP permission)
   */
  router.post(
    "/",
    ...validatedHandler(
      CreateMcpRequestSchema,
      MCPResponseSchema,
      async (req: Request, _res, data: CreateMcpRequest) => {
        if (!hasPermission(req, PermissionType.ADD_MCP)) {
          return sendForbidden(
            _res,
            req,
            AuditApiAction.MCP_CREATE,
            "ADD_MCP permission required"
          );
        }

        const existing = await mcpRepo.findByNamespace(data.namespace);
        if (existing) {
          throw Object.assign(new Error("MCP with this namespace already exists"), { status: 409 });
        }

        const { masterAuth, ...mcpData } = data;
        const encryptedAuth = masterAuth ? encryptJSON(masterAuth) : null;

        const { record: mcp } = await mcpRepo.create({
          ...mcpData,
          createdById: req.apiAuth!.userId,
          masterAuth: encryptedAuth,
        });

        logger.info({ mcpId: mcp.id, namespace: mcp.namespace }, "Added MCP");

        return transformMcpResponse(mcp);
      },
      {
        action: AuditApiAction.MCP_CREATE,
        successStatus: 201,
        errorMessage: "Failed to add MCP",
        getAuditDetails: (_req, result) => ({
          mcpId: result?.id,
          namespace: result?.namespace,
        }),
      }
    )
  );

  /**
   * PUT /api/mcps/:namespace
   * Update MCP by namespace
   */
  router.put(
    "/:namespace",
    ...validatedHandler(
      UpdateMcpRequestSchema,
      MCPResponseSchema,
      async (req: Request<{ namespace: string }>, res, data: UpdateMcpRequest) => {
        const existing = await mcpRepo.findByNamespace(req.params.namespace);
        if (!existing) {
          return sendNotFound(res, "MCP", req, AuditApiAction.MCP_UPDATE, {
            namespace: req.params.namespace,
          });
        }

        if (!(await userRepo.isAuthorized(req.apiAuth!.userId, existing))) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.MCP_UPDATE,
            "You can only update MCPs you created or that were created by users you created",
            { namespace: req.params.namespace }
          );
        }

        const { masterAuth, ...updateData } = data;
        const encryptedAuth =
          masterAuth !== undefined ? encryptJSON(masterAuth) : undefined;

        const updated = await mcpRepo.update({
          id: existing.id,
          ...updateData,
          ...(encryptedAuth !== undefined && { masterAuth: encryptedAuth }),
        });

        logger.info({ namespace: req.params.namespace }, "Updated MCP");

        return transformMcpResponse(updated);
      },
      {
        action: AuditApiAction.MCP_UPDATE,
        errorMessage: "Failed to update MCP",
        getAuditDetails: (req, result) => ({
          namespace: req.params.namespace,
          mcpId: result?.id,
        }),
      }
    )
  );


  /**
   * DELETE /api/mcps/all
   * Bulk delete MCPs created by user and descendants
   */
  router.delete(
    "/all",
    asyncHandler(
      null,
      async (req) => {
        const descendantIds = await userRepo.collectDescendantIds(req.apiAuth!.userId);
        const allUserIds = [req.apiAuth!.userId, ...descendantIds];

        const mcps = await mcpRepo.findByCreators(allUserIds);
        const namespaces = mcps.map((m) => m.namespace);

        await mcpRepo.deleteByCreators(allUserIds);

        logger.info(
          { userId: req.apiAuth!.userId, count: mcps.length },
          "Bulk deleted MCPs"
        );

        return transformBulkDeleteResponse(mcps.length, namespaces);
      },
      {
        action: AuditApiAction.MCP_DELETE,
        errorMessage: "Failed to bulk delete MCPs",
        getAuditDetails: (_req, result: BulkDeleteResponse | undefined) => ({
          count: result?.count,
          namespaces: result?.mcps,
        }),
      }
    )
  );
  /**
   * GET /api/mcps/:namespace
   * Get MCP by namespace
   */
  router.get(
    "/:namespace",
    asyncHandler(
      MCPResponseSchema,
      async (req: Request<{ namespace: string }>, res) => {
        const mcp = await mcpRepo.findByNamespace(req.params.namespace);
        if (!mcp) {
          return sendNotFound(res, "MCP", req, AuditApiAction.MCP_VIEW, {
            namespace: req.params.namespace,
          });
        }

        return transformMcpResponse(mcp);
      },
      {
        action: AuditApiAction.MCP_VIEW,
        errorMessage: "Failed to get MCP",
        getAuditDetails: (_req, result) => ({
          mcpId: result?.id,
          namespace: result?.namespace,
        }),
      }
    )
  );

  /**
    * DELETE /api/mcps/:namespace
    */
  router.delete(
    "/:namespace",
    asyncHandler(
      null,
      async (req: Request<{ namespace: string }>, res) => {
        const mcp = await mcpRepo.findByNamespace(req.params.namespace);
        if (!mcp) {
          return sendNotFound(res, "MCP", req, AuditApiAction.MCP_DELETE, {
            namespace: req.params.namespace,
          });
        }

        if (!(await userRepo.isAuthorized(req.apiAuth!.userId, mcp))) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.MCP_DELETE,
            "You can only delete MCPs you created or that were created by users you created",
            { namespace: req.params.namespace }
          );
        }

        await mcpRepo.delete(mcp.id);

        logger.info(
          { namespace: req.params.namespace, userId: req.apiAuth!.userId },
          "Deleted MCP"
        );

        return sent();
      },
      {
        action: AuditApiAction.MCP_DELETE,
        successStatus: 204,
        errorMessage: "Failed to delete MCP",
        getAuditDetails: (req) => ({
          namespace: req.params.namespace,
        }),
      }
    )
  );

  return router;
}
