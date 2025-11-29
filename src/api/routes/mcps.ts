import express, { Request, Response, Router } from 'express';
import { PrismaClient, PermissionType } from '@prisma/client';
import logger from '../../utils/logger.js';
import { McpRepository } from '../database/repositories/index.js';
import { hasPermission } from '../middleware/auth.js';
import { auditApiLog, AuditApiAction } from '../../utils/audit-log.js';
import { z } from 'zod';
import { sendZodError } from '../../utils/error-formatter.js';

/**
 * Check if user has permission to delete an MCP
 * Permission granted if:
 * - User is the creator of the MCP
 * - User is an admin
 * - User is the creator of the creator (recursively)
 */
async function checkMcpDeletePermission(
  user: any,
  mcp: any,
  prisma: PrismaClient
): Promise<boolean> {
  // Admin can delete anything
  if (user.isAdmin) {
    return true;
  }

  // Check if user is direct creator
  if (mcp.createdById === user.id) {
    return true;
  }

  // Check creator hierarchy recursively
  if (mcp.createdById) {
    let currentCreatorId = mcp.createdById;
    const visited = new Set<string>([currentCreatorId]);

    while (currentCreatorId) {
      const creator = await prisma.apiUser.findUnique({
        where: { id: currentCreatorId },
        select: { createdById: true }
      });

      if (!creator || !creator.createdById) {
        break;
      }

      if (creator.createdById === user.id) {
        return true;
      }

      // Prevent infinite loops
      if (visited.has(creator.createdById)) {
        break;
      }

      visited.add(creator.createdById);
      currentCreatorId = creator.createdById;
    }
  }

  return false;
}

export function createMcpRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const mcpRepo = new McpRepository(prisma);

  /**
   * Schema for creating/updating MCPs
   */
  const McpSchema = z.object({
    namespace: z.string().min(1),
    url: z.string().url(),
    author: z.string().min(1),
    description: z.string().min(1),
    version: z.string().optional(),
    stateless: z.boolean().optional(),
    tokenCost: z.number().positive().optional(),
    authStrategy: z.enum(['MASTER', 'TOKEN_SPECIFIC', 'NONE']).optional(),
    masterAuthConfig: z.string().optional(),
  });

  /**
   * GET /api/mcps
   * List all master MCPs
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const mcps = await mcpRepo.listAll();

      res.json(mcps.map(mcp => ({
        id: mcp.id,
        namespace: mcp.namespace,
        url: mcp.url,
        author: mcp.author,
        description: mcp.description,
        version: mcp.version,
        stateless: mcp.stateless,
        token_cost: mcp.tokenCost,
        auth_strategy: mcp.authStrategy,
        created_at: mcp.createdAt,
        updated_at: mcp.updatedAt,
      })));
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list MCPs');
      res.status(500).json({ error: 'Failed to list MCPs' });
    }
  });

  /**
   * GET /api/mcps/namespace/:namespace
   * Get MCP by namespace
   */
  router.get('/namespace/:namespace', async (req: Request, res: Response) => {
    try {
      const mcp = await mcpRepo.findByNamespace(req.params.namespace);

      if (!mcp) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      res.json({
        id: mcp.id,
        namespace: mcp.namespace,
        url: mcp.url,
        author: mcp.author,
        description: mcp.description,
        version: mcp.version,
        stateless: mcp.stateless,
        token_cost: mcp.tokenCost,
        auth_strategy: mcp.authStrategy,
        created_at: mcp.createdAt,
        updated_at: mcp.updatedAt,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get MCP by namespace');
      res.status(500).json({ error: 'Failed to get MCP' });
    }
  });

  /**
   * GET /api/mcps/:id
   * Get a specific MCP by ID
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const mcp = await mcpRepo.findById(req.params.id);

      if (!mcp) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      res.json({
        id: mcp.id,
        namespace: mcp.namespace,
        url: mcp.url,
        author: mcp.author,
        description: mcp.description,
        version: mcp.version,
        stateless: mcp.stateless,
        token_cost: mcp.tokenCost,
        auth_strategy: mcp.authStrategy,
        created_at: mcp.createdAt,
        updated_at: mcp.updatedAt,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get MCP by ID');
      res.status(500).json({ error: 'Failed to get MCP' });
    }
  });

  /**
   * POST /api/mcps
   * Create a new master MCP (requires ADD_MCP permission)
   */
  router.post('/', async (req: Request, res: Response) => {
    if (!req.apiAuth!.isAdmin && !hasPermission(req, PermissionType.ADD_MCP)) {
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
      const data = McpSchema.parse(req.body);

      // Check if namespace already exists
      const existing = await mcpRepo.findByNamespace(data.namespace);
      if (existing) {
        res.status(409).json({ error: 'MCP with this namespace already exists' });
        return;
      }

      const mcp = await mcpRepo.create({
        ...data,
        createdById: req.apiAuth!.userId
      });

      auditApiLog({
        action: AuditApiAction.MCP_CREATE,
        success: true,
        details: { mcpId: mcp.id, namespace: mcp.namespace },
      }, req);

      logger.info({ mcpId: mcp.id, namespace: mcp.namespace }, 'Created master MCP');

      res.status(201).json({
        id: mcp.id,
        namespace: mcp.namespace,
        url: mcp.url,
        author: mcp.author,
        description: mcp.description,
        version: mcp.version,
        stateless: mcp.stateless,
        token_cost: mcp.tokenCost,
        auth_strategy: mcp.authStrategy,
        master_auth_config: mcp.masterAuthConfig,
        created_at: mcp.createdAt,
        updated_at: mcp.updatedAt,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        sendZodError(res, error, "Invalid MCP data");
        return;
      }

      logger.error({ error: error.message }, 'Failed to create MCP');
      res.status(500).json({ error: 'Failed to create MCP' });
    }
  });

  /**
   * PUT /api/mcps/:id
   * Update a master MCP
   */
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const existing = await mcpRepo.findById(req.params.id);
      if (!existing) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      const PartialMcpSchema = McpSchema.partial().omit({ namespace: true });
      const data = PartialMcpSchema.parse(req.body);

      const updated = await mcpRepo.update(req.params.id, data);

      logger.info({ mcpId: req.params.id }, 'Updated master MCP');

      res.json({
        id: updated.id,
        namespace: updated.namespace,
        url: updated.url,
        author: updated.author,
        description: updated.description,
        version: updated.version,
        stateless: updated.stateless,
        token_cost: updated.tokenCost,
        auth_strategy: updated.authStrategy,
        master_auth_config: updated.masterAuthConfig,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        sendZodError(res, error, "Invalid MCP data");
        return;
      }

      logger.error({ error: error.message }, 'Failed to update MCP');
      res.status(500).json({ error: 'Failed to update MCP' });
    }
  });

  /**
   * DELETE /api/mcps (bulk delete - all user's MCPs)
   */
  router.delete('/', async (req: Request, res: Response) => {
    try {
      // Find all MCPs created by this user
      const userMcps = await prisma.mcp.findMany({
        where: { createdById: req.apiAuth!.userId }
      });

      const namespaces = userMcps.map(m => m.namespace);

      // Delete all
      await prisma.mcp.deleteMany({
        where: { createdById: req.apiAuth!.userId }
      });

      auditApiLog({
        action: AuditApiAction.MCP_DELETE,
        success: true,
        details: { count: userMcps.length, namespaces },
      }, req);

      logger.info(
        { userId: req.apiAuth!.userId, count: userMcps.length },
        'Bulk deleted user MCPs'
      );

      res.json({
        deleted: userMcps.length,
        mcps: namespaces
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to bulk delete MCPs');
      res.status(500).json({ error: 'Failed to bulk delete MCPs' });
    }
  });

  /**
   * DELETE /api/mcps/:namespace
   * Delete a master MCP (cascades to all collection instances)
   */
  router.delete('/:namespace', async (req: Request, res: Response) => {
    try {
      const mcp = await mcpRepo.findByNamespace(req.params.namespace);

      if (!mcp) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Permission check: must be creator, admin, or creator of creator
      const hasPermission = await checkMcpDeletePermission(req.apiAuth, mcp, prisma);

      if (!hasPermission) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Insufficient permissions to delete MCP',
        }, req);

        res.status(403).json({ error: 'Forbidden: You do not have permission to delete this MCP' });
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
      logger.error({ error: error.message }, 'Failed to delete MCP');
      res.status(500).json({ error: 'Failed to delete MCP' });
    }
  });

  return router;
}
