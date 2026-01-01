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
import logger from "../../utils/logger.js";
import { McpRepository, ApiUserRepository } from "../database/repositories/index.js";
import { hasPermission } from "../middleware/auth.js";
import { auditApiLog, AuditApiAction } from "../../utils/audit-log.js";
import { z } from "zod";
import { sendZodError } from "./utils/error-formatter.js";
import { MCPAuthConfigSchema, AuthStrategySchema } from "../../core/config/schemas.js";
import { ErrorResponse } from "./utils/schemas.js";

/**
 * Request/Response schemas for MCP endpoints
 */

const CreateMcpRequestSchema = z.object({
  namespace: z.string()
    .min(1)
    .regex(/^(?!.*__)([A-Za-z0-9_.-]+)$/, "Namespace must contain only letters, digits, underscores, dots, and hyphens (no consecutive underscores)"),
  url: z.url(),
  description: z.string().min(1),
  version: z.string().min(1).default("1.0.0"),
  stateless: z.boolean().default(false),
  authStrategy: AuthStrategySchema.default("NONE"),
  masterAuth: MCPAuthConfigSchema.optional()
});

export const MCPResponseSchema = CreateMcpRequestSchema.extend({
  id: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.object({
    id: z.string(),
    name: z.string(),
  }).optional(),
}).omit({
  masterAuth: true,
});

const UpdateMcpRequestSchema = CreateMcpRequestSchema.partial().omit({ namespace: true });

const BulkDeleteResponseSchema = z.object({
  deleted: z.number(),
  mcps: z.array(z.string()),
});


export type CreateMcpRequest = z.infer<typeof CreateMcpRequestSchema>;
export type UpdateMcpRequest = z.infer<typeof UpdateMcpRequestSchema>;
export type McpResponse = z.infer<typeof MCPResponseSchema>;
export type BulkDeleteResponse = z.infer<typeof BulkDeleteResponseSchema>;

export function createMcpRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const mcpRepo = new McpRepository(prisma);
  const userRepo = new ApiUserRepository(prisma);

  /**
   * GET /api/mcps
   * List all MCPs
   */
  router.get('/', async (req: Request, res: Response<McpResponse[] | ErrorResponse>): Promise<void> => {
    try {
      const mcps = await mcpRepo.listAll();

      auditApiLog({
        action: AuditApiAction.MCP_VIEW,
        success: true,
        details: { count: mcps.length },
      }, req);

      res.json(mcps.map((m) => MCPResponseSchema.strip().parse(m)));
    } catch (error: any) {
      auditApiLog({
        action: AuditApiAction.MCP_VIEW,
        success: false,
        errorMessage: error.message,
      }, req);

      logger.error({ error: error.message }, 'Failed to list MCPs');
      res.status(500).json({ error: 'Failed to list MCPs' });
    }
  });


  /**
   * POST /api/mcps
   * Add a new MCP (requires ADD_MCP permission)
   */
  router.post('/', async (req: Request<{}, McpResponse | ErrorResponse, CreateMcpRequest>, res: Response<McpResponse | ErrorResponse>): Promise<void> => {
    if (!hasPermission(req, PermissionType.ADD_MCP)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Insufficient permissions to add MCP',
      }, req);

      res.status(403).json({
        error: 'Insufficient permissions',
        message: 'ADD_MCP permission required',
      });
      return;
    }

    try {
      const data = CreateMcpRequestSchema.parse(req.body);
      console.log(data);
      // Check if namespace already exists
      const existing = await mcpRepo.findByNamespace(data.namespace);
      if (existing) {
        res.status(409).json({ error: 'MCP with this namespace already exists' });
        return;
      }
      const mcp = await mcpRepo.create(
        data,
        req.apiAuth!.userId
      );

      auditApiLog({
        action: AuditApiAction.MCP_CREATE,
        success: true,
        details: { mcpId: mcp.id, namespace: mcp.namespace },
      }, req);

      logger.info({ mcpId: mcp.id, namespace: mcp.namespace }, 'Added MCP');

      res.status(201).json(MCPResponseSchema.strip().parse(mcp));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error({
          endpoint: 'POST /api/mcps',
          error: error.issues,
          receivedData: req.body,
        }, 'Validation failed: missing or invalid parameters');
        sendZodError(res, error, "Invalid MCP data");
        return;
      }

      logger.error({ error: error.message }, 'Failed to add MCP');
      res.status(500).json({ error: 'Failed to add MCP' });
    }
  });

  /**
   * PUT /api/mcps/:namespace
   * Update a MCP by namespace (requires hierarchical ownership)
   */
  router.put('/:namespace', async (req: Request<{ namespace: string }, McpResponse | ErrorResponse, UpdateMcpRequest>, res: Response<McpResponse | ErrorResponse>): Promise<void> => {
    try {
      const existing = await mcpRepo.findByNamespace(req.params.namespace);
      if (!existing) {
        auditApiLog({
          action: AuditApiAction.MCP_UPDATE,
          success: false,
          errorMessage: 'MCP not found',
          details: { namespace: req.params.namespace },
        }, req);

        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      if (!(await userRepo.isAuthorized(req.apiAuth!.userId, existing))) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Insufficient permissions to update MCP',
          details: { namespace: req.params.namespace },
        }, req);

        res.status(403).json({
          error: 'Forbidden',
          message: 'You can only update MCPs you created or that were created by users you created',
        });
        return;
      }

      const data = UpdateMcpRequestSchema.parse(req.body);
      const updated = await mcpRepo.update(existing.id, data);

      auditApiLog({
        action: AuditApiAction.MCP_UPDATE,
        success: true,
        details: { mcpId: updated.id, namespace: updated.namespace },
      }, req);

      logger.info({ namespace: req.params.namespace }, 'Updated MCP');

      res.json(MCPResponseSchema.strip().parse(updated));
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        auditApiLog({
          action: AuditApiAction.MCP_UPDATE,
          success: false,
          errorMessage: 'Validation error',
          details: { namespace: req.params.namespace },
        }, req);

        logger.error({
          endpoint: 'PUT /api/mcps/:namespace',
          namespace: req.params.namespace,
          error: error.issues,
          receivedData: req.body,
        }, 'Validation failed: missing or invalid parameters');
        sendZodError(res, error, "Invalid MCP data");
        return;
      }

      auditApiLog({
        action: AuditApiAction.MCP_UPDATE,
        success: false,
        errorMessage: error.message,
        details: { namespace: req.params.namespace },
      }, req);

      logger.error({ error: error.message }, 'Failed to update MCP');
      res.status(500).json({ error: 'Failed to update MCP' });
    }
  });

  /**
   * DELETE /api/mcps/all
   * Bulk delete all MCPs created by authenticated user and their descendants
   *
   * NOTE: This only deletes MCP records, not user accounts. Users remain untouched.
   */
  router.delete('/all', async (req: Request, res: Response<BulkDeleteResponse | ErrorResponse>): Promise<void> => {
    try {
      // Collect IDs of users whose MCPs should be deleted
      const descendantIds = await userRepo.collectDescendantIds(req.apiAuth!.userId);
      const allUserIds = [req.apiAuth!.userId, ...descendantIds];

      // Find all MCPs created by authenticated user and their descendants
      const userMcps = await mcpRepo.findByCreators(allUserIds);
      const namespaces = userMcps.map(m => m.namespace);

      // Delete all MCPs (users are NOT deleted, only MCP records)
      await mcpRepo.deleteByCreators(allUserIds);

      auditApiLog({
        action: AuditApiAction.MCP_DELETE,
        success: true,
        details: { count: userMcps.length, namespaces },
      }, req);

      logger.info(
        { userId: req.apiAuth!.userId, count: userMcps.length },
        'Bulk deleted MCPs (hierarchical)'
      );

      res.json({
        deleted: userMcps.length,
        mcps: namespaces
      });
    } catch (error: any) {
      logger.error({ error: error.message, userId: req.apiAuth!.userId }, 'Failed to bulk delete MCPs');
      res.status(500).json({ error: 'Failed to bulk delete MCPs' });
    }
  });

  /**
   * GET /api/mcps/:namespace
   * Get MCP by namespace
   */
  router.get('/:namespace', async (req: Request<{ namespace: string }>, res: Response<McpResponse | ErrorResponse>): Promise<void> => {
    try {
      const mcp = await mcpRepo.findByNamespace(req.params.namespace);

      if (!mcp) {
        auditApiLog({
          action: AuditApiAction.MCP_VIEW,
          success: false,
          errorMessage: 'MCP not found',
          details: { namespace: req.params.namespace },
        }, req);

        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      auditApiLog({
        action: AuditApiAction.MCP_VIEW,
        success: true,
        details: { mcpId: mcp.id, namespace: mcp.namespace },
      }, req);

      res.json(MCPResponseSchema.strip().parse(mcp));
    } catch (error: any) {
      auditApiLog({
        action: AuditApiAction.MCP_VIEW,
        success: false,
        errorMessage: error.message,
        details: { namespace: req.params.namespace },
      }, req);

      logger.error({ error: error.message, namespace: req.params.namespace }, 'Failed to get MCP by namespace');
      res.status(500).json({ error: 'Failed to get MCP' });
    }
  });

  /**
   * DELETE /api/mcps/:namespace
   * Delete a MCP (cascades to all bundle instances)
   */
  router.delete('/:namespace', async (req: Request<{ namespace: string }>, res: Response<ErrorResponse | void>): Promise<void> => {
    try {
      const mcp = await mcpRepo.findByNamespace(req.params.namespace);

      if (!mcp) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      if (!(await userRepo.isAuthorized(req.apiAuth!.userId, mcp))) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Insufficient permissions to delete MCP',
        }, req);

        res.status(403).json({
          error: 'Forbidden',
          message: 'You can only delete MCPs you created or that were created by users you created',
        });
        return;
      }

      await mcpRepo.delete(req.params.namespace);

      auditApiLog({
        action: AuditApiAction.MCP_DELETE,
        success: true,
        details: { namespace: req.params.namespace },
      }, req);

      logger.info({ namespace: req.params.namespace, userId: req.apiAuth!.userId }, 'Deleted MCP');

      res.status(204).send();
    } catch (error: any) {
      logger.error({ error: error.message, namespace: req.params.namespace }, 'Failed to delete MCP');
      res.status(500).json({ error: 'Failed to delete MCP' });
    }
  });

  return router;
}
