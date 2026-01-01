/**
 * Bundle Routes - Bundle (collection) management
 *
 * Manages bundles, which are logical groupings of MCP servers with per-MCP permission
 * settings. Adding an MCP to a bundle automatically creates the master MCP record if
 * it doesn't exist. Deleting a bundle cascades to all associated tokens.
 *
 * Endpoints:
 * - GET    /api/bundles                      - List all bundles
 * - GET    /api/bundles/me                   - List bundles created by authenticated user
 * - POST   /api/bundles                      - Create bundle
 * - GET    /api/bundles/:id                  - List MCPs in bundle
 * - POST   /api/bundles/:id                  - Add MCP to bundle by namespace
 * - DELETE /api/bundles/:id                  - Delete bundle (owner or admin)
 * - DELETE /api/bundles/:id/:namespace       - Remove MCP from bundle
 *
 * Token endpoints:
 * - POST   /api/bundles/:id/tokens           - Generate token
 * - GET    /api/bundles/:id/tokens           - List tokens
 * - DELETE /api/bundles/:id/tokens/:tokenId  - Revoke token
 */

import express, { Request, Response, Router } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../../utils/logger.js";
import {
  AccessTokenRepository,
  ApiUserRepository,
  BundleRepository,
  McpRepository,
} from "../database/repositories/index.js";
import { McpPermissionsSchema, MCPConfig } from "../../core/config/schemas.js";
import { z } from "zod";
import { sendZodError } from "./utils/error-formatter.js";
import { ErrorResponse } from "./utils/schemas.js";
import { McpResponse, MCPResponseSchema } from "./mcps.js";
import { AuditApiAction, auditApiLogSession } from "../../utils/audit-log.js";

/**
 * Request/Response schemas for bundle endpoints
 */

const BundleCreatorSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact: z.string(),
  department: z.string().nullable(),
  isAdmin: z.boolean(),
});

const CreateBundleRequestSchema = z.object({
  name: z.string().min(1, "Bundle name is required and cannot be empty"),
  description: z.string(),
});

const CreateBundleResponseSchema = CreateBundleRequestSchema.extend({
  id: z.string(),
  createdAt: z.date(),
  createdBy: BundleCreatorSchema.nullable(),
});

const BundleMcpWithPermissionsSchema = MCPResponseSchema.extend({
  permissions: McpPermissionsSchema,
});

const BundleResponseSchema = CreateBundleResponseSchema.extend({
  mcps: z.array(BundleMcpWithPermissionsSchema),
  createdBy: BundleCreatorSchema.nullable(),
});

const GenerateTokenRequestSchema = z.object({
  name: z.string().min(1, "Token name is required and cannot be empty"),
  description: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});
const TokenResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  expiresAt: z.date().nullable(),
  revoked: z.boolean(),
  createdAt: z.date(),
});
const ListTokenReponseSchema = z.array(TokenResponseSchema);

const GenerateTokenResponseSchema = TokenResponseSchema.extend({
  token: z.string(),
});


const _AddMcpByNamespaceRequestSchema = z.object({
  namespace: z.string().min(1, "Namespace required"),
  permissions: McpPermissionsSchema.optional(),
});

const AddMcpsByNamespaceRequestSchema = z.union([
  _AddMcpByNamespaceRequestSchema,
  z.array(_AddMcpByNamespaceRequestSchema).min(1, "At least one MCP required")
]);

const AddMcpByNamespaceResponseSchema = z.object({
  added: z.array(MCPResponseSchema),
  errors: z.array(z.object({
    namespace: z.string(),
    reason: z.string(),
  })).optional(),
});

export type CreateBundleRequest = z.infer<typeof CreateBundleRequestSchema>;
export type GenerateTokenRequest = z.infer<typeof GenerateTokenRequestSchema>;
export type AddMcpsByNamespaceRequest = z.infer<typeof AddMcpsByNamespaceRequestSchema>;

export type CreateBundleResponse = z.infer<typeof CreateBundleResponseSchema>;
export type GenerateTokenResponse = z.infer<typeof GenerateTokenResponseSchema>;
export type BundleResponse = z.infer<typeof BundleResponseSchema>;
export type ListTokenReponse = z.infer<typeof ListTokenReponseSchema>;
export type AddMcpByNamespaceResponse = z.infer<typeof AddMcpByNamespaceResponseSchema>;
/**
 * Create bundle management routes
 *
 * Factory function that creates an Express router with all bundle-related endpoints.
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express router with bundle routes
 */
export function createBundleRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const bundleRepo = new BundleRepository(prisma);
  const mcpRepo = new McpRepository(prisma);
  const tokenRepo = new AccessTokenRepository(prisma);
  const userRepo = new ApiUserRepository(prisma);

  /**
   * GET /api/bundles/me
   * List bundles created by the authenticated user or their descendants
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const userIds = await userRepo.collectDescendantIds(req.apiAuth!.userId);
      const ids = [req.apiAuth!.userId, ...userIds];
      const bundles = await bundleRepo.listByCreatorHierarchy(ids);

      const response = bundles.map((bundle) => (BundleResponseSchema.parse({
        ...bundle,
        mcps: bundle.mcps.map((mcpBundleEntry) => ({
          ...MCPResponseSchema.strip().parse(mcpBundleEntry.mcp),
          permissions: {
            allowedTools: JSON.parse(mcpBundleEntry.allowedTools),
            allowedResources: JSON.parse(mcpBundleEntry.allowedResources),
            allowedPrompts: JSON.parse(mcpBundleEntry.allowedPrompts),
          },
        })),
      })));

      auditApiLogSession({
        action: AuditApiAction.BUNDLE_VIEW,
        success: true,
        details: { count: bundles.length, scope: "user_hierarchy" }
      });

      res.json(response);
    } catch (error: any) {
      auditApiLogSession({
        action: AuditApiAction.BUNDLE_VIEW,
        success: false,
        errorMessage: error.message
      });
      logger.error({ error: error.issues.message }, 'Failed to list user bundles');
      res.status(500).json({ error: 'Failed to list bundles' });
    }
  });

  /**
   * GET /api/bundles
   * List all bundles
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const bundles = await bundleRepo.list();

      const response = bundles.map((bundle) => (BundleResponseSchema.parse({
        ...bundle,
        mcps: bundle.mcps.map((mcpBundleEntry) => ({
          ...MCPResponseSchema.strip().parse(mcpBundleEntry.mcp),
          permissions: {
            allowedTools: JSON.parse(mcpBundleEntry.allowedTools),
            allowedResources: JSON.parse(mcpBundleEntry.allowedResources),
            allowedPrompts: JSON.parse(mcpBundleEntry.allowedPrompts),
          },
        })),
      })));

      auditApiLogSession({
        action: AuditApiAction.BUNDLE_VIEW,
        success: true,
        details: { count: bundles.length, scope: "all" }
      });

      res.json(response);
    } catch (error: any) {
      auditApiLogSession({
        action: AuditApiAction.BUNDLE_VIEW,
        success: false,
        errorMessage: error.message
      });
      logger.error({ error: error.issues.message }, 'Failed to list bundles');
      res.status(500).json({ error: 'Failed to list bundles' });
    }
  });

  /**
   * GET /api/bundles/:id
   * Get a specific bundle with its MCPs
   */
  router.get('/:id', async (req: Request, res: Response<BundleResponse | ErrorResponse>) => {
    try {
      const bundle = await bundleRepo.findById(req.params.id);

      if (!bundle) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_VIEW,
          success: false,
          errorMessage: "Bundle not found",
          details: { bundleId: req.params.id }
        });
        res.status(404).json({ error: 'Bundle not found' });
        return;
      }

      const response = BundleResponseSchema.parse({
        ...bundle,
        mcps: bundle.mcps.map((mcpBundleEntry) => ({
          ...MCPResponseSchema.strip().parse(mcpBundleEntry.mcp),
          permissions: {
            allowedTools: JSON.parse(mcpBundleEntry.allowedTools),
            allowedResources: JSON.parse(mcpBundleEntry.allowedResources),
            allowedPrompts: JSON.parse(mcpBundleEntry.allowedPrompts),
          },
        })),
      });

      auditApiLogSession({
        action: AuditApiAction.BUNDLE_VIEW,
        success: true,
        details: { bundleId: bundle.id, mcpCount: bundle.mcps.length }
      });

      res.json(response);
    } catch (error: any) {
      auditApiLogSession({
        action: AuditApiAction.BUNDLE_VIEW,
        success: false,
        errorMessage: error.message,
        details: { bundleId: req.params.id }
      });
      logger.error({ error: error.issues.message }, 'Failed to get bundle');
      res.status(500).json({ error: 'Failed to get bundle' });
    }
  });

  /**
   * POST /api/bundles
   * Create a new bundle
   */
  router.post('/', async (req: Request<{}, CreateBundleResponse | ErrorResponse, CreateBundleRequest>, res: Response<CreateBundleResponse | ErrorResponse>): Promise<void> => {
    try {
      const data = CreateBundleRequestSchema.parse(req.body);

      const createdById = req.apiAuth?.userId;
      const bundle = await bundleRepo.create(data.name, data.description, createdById);

      auditApiLogSession({
        action: AuditApiAction.BUNDLE_CREATE,
        details: {
          bundleId: bundle.id,
          userId: bundle.id
        }
      })

      res.status(201).json({
        id: bundle.id,
        name: bundle.name,
        description: bundle.description,
        createdAt: bundle.createdAt,
        createdBy: bundle.createdBy,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        logger.error({
          endpoint: 'POST /api/bundles',
          error: error.issues,
          receivedData: req.body,
        }, 'Validation failed: missing or invalid parameters');
        sendZodError(res, error, "Invalid bundle creation request");
        return;
      }

      logger.error({ error: error.issues.message }, 'Failed to create bundle');
      res.status(500).json({ error: `Failed to create bundle ${error.message}` });
    }
  });

  /**
   * DELETE /api/bundles/:id
   * Delete a bundle (requires hierarchical ownership or admin)
   * Tokens cascade delete automatically via Prisma
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const bundle = await bundleRepo.findById(req.params.id);

      if (!bundle) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_DELETE,
          success: false,
          errorMessage: "Bundle not found",
          details: { bundleId: req.params.id }
        });
        res.status(404).json({ error: 'Bundle not found' });
        return;
      }

      if (!(await userRepo.isAuthorized(req.apiAuth!.userId, bundle))) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_DELETE,
          success: false,
          errorMessage: "Insufficient permissions",
          details: { bundleId: req.params.id }
        });
        res.status(403).json({
          error: 'Forbidden',
          message: 'You can only delete bundles you created or that were created by users you created',
        });
        return;
      }

      await bundleRepo.delete(req.params.id);

      auditApiLogSession({
        action: AuditApiAction.BUNDLE_DELETE,
        success: true,
        details: { bundleId: req.params.id, bundleName: bundle.name }
      });

      logger.info({ bundleId: req.params.id, deletedBy: req.apiAuth!.userId }, "Deleted bundle");

      res.status(204).send();
    } catch (error: any) {
      auditApiLogSession({
        action: AuditApiAction.BUNDLE_DELETE,
        success: false,
        errorMessage: error.message,
        details: { bundleId: req.params.id }
      });
      logger.error({ error: error.issues.message }, 'Failed to delete bundle');
      res.status(500).json({ error: 'Failed to delete bundle' });
    }
  });

  /**
   * POST /api/bundles/:id
   * Add MCP(s) to a bundle by namespace(s) - accepts single object or array
   * MCPs must exist in the master registry
   */
  router.post('/:id', async (req: Request<{ id: string }, AddMcpByNamespaceResponse | ErrorResponse, AddMcpsByNamespaceRequest>, res: Response<AddMcpByNamespaceResponse | ErrorResponse>): Promise<void> => {
    try {
      const data = AddMcpsByNamespaceRequestSchema.parse(req.body);

      // Validate bundle exists
      const bundle = await bundleRepo.findById(req.params.id);
      if (!bundle) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_UPDATE,
          success: false,
          errorMessage: "Bundle not found",
          details: { bundleId: req.params.id }
        });
        res.status(404).json({ error: 'Bundle not found' });
        return;
      }

      if (!(await userRepo.isAuthorized(req.apiAuth!.userId, bundle))) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_UPDATE,
          success: false,
          errorMessage: "Insufficient permissions",
          details: { bundleId: req.params.id }
        });
        res.status(403).json({
          error: 'Forbidden',
          message: 'You can only modify bundles you created or that were created by users you created',
        });
        return;
      }

      // Normalize input to array
      const mcpRequests = Array.isArray(data) ? data : [data];

      const added: Array<McpResponse> = [];
      const errors: Array<{ namespace: string; reason: string }> = [];

      // Process each MCP request
      for (const mcpRequest of mcpRequests) {
        // Find MCP in master registry
        const mcp = await mcpRepo.findByNamespace(mcpRequest.namespace);

        if (!mcp) {
          errors.push({ namespace: mcpRequest.namespace, reason: 'MCP not found in master registry' });
          continue;
        }

        // Check if MCP already in bundle
        const existing = await bundleRepo.findMcpInBundle(req.params.id, mcp.id);

        if (existing) {
          errors.push({ namespace: mcpRequest.namespace, reason: 'Already exists in bundle' });
          continue;
        }

        // Add MCP to bundle with permissions
        await bundleRepo.addMcp(req.params.id, mcp.id, mcpRequest.permissions);

        added.push(MCPResponseSchema.strip().parse(mcp));

        logger.info(
          { bundleId: req.params.id, namespace: mcp.namespace },
          "Added MCP to bundle"
        );
      }

      // Build aggregated error if any MCPs had issues
      if (errors.length > 0) {
        const errorMessages = errors.map(e => `${e.namespace}: ${e.reason}`).join('; ');
        const errorMessage = `Failed to add some MCPs: ${errorMessages}`;

        logger.error({
          endpoint: 'POST /api/bundles/:id',
          bundleId: req.params.id,
          errors,
          added: added.map(a => a.namespace),
        }, errorMessage);

        res.status(207).json({
          added,
          error: errorMessage,
          errors,
        });
        return;
      }

      auditApiLogSession({
        action: AuditApiAction.BUNDLE_UPDATE,
        success: true,
        details: {
          bundleId: req.params.id,
          addedMcps: added.map(m => m.namespace),
          addedCount: added.length
        }
      });

      res.status(201).json({
        added,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_UPDATE,
          success: false,
          errorMessage: "Validation error",
          details: { bundleId: req.params.id }
        });
        logger.error({
          endpoint: 'POST /api/bundles/:id',
          bundleId: req.params.id,
          error: error.issues,
          receivedData: req.body,
        }, 'Validation failed: missing or invalid parameters for adding MCPs by namespace');
        sendZodError(res, error, "Invalid request");
        return;
      }

      auditApiLogSession({
        action: AuditApiAction.BUNDLE_UPDATE,
        success: false,
        errorMessage: error.message,
        details: { bundleId: req.params.id }
      });
      logger.error({ error: error.issues.message, bundleId: req.params.id }, 'Failed to add MCP(s)');
      res.status(500).json({ error: 'Failed to add MCP(s)' });
    }
  });

  /**
   * DELETE /api/bundles/:id/:namespace
   * Remove an MCP from a bundle (requires hierarchical ownership)
   */
  router.delete('/:id/:namespace', async (req: Request, res: Response) => {
    try {
      const bundle = await bundleRepo.findById(req.params.id);

      if (!bundle) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_UPDATE,
          success: false,
          errorMessage: "Bundle not found",
          details: { bundleId: req.params.id, namespace: req.params.namespace }
        });
        res.status(404).json({ error: 'Bundle not found' });
        return;
      }

      if (!(await userRepo.isAuthorized(req.apiAuth!.userId, bundle))) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_UPDATE,
          success: false,
          errorMessage: "Insufficient permissions",
          details: { bundleId: req.params.id, namespace: req.params.namespace }
        });
        res.status(403).json({
          error: 'Forbidden',
          message: 'You can only modify bundles you created or that were created by users you created',
        });
        return;
      }

      // Find the master MCP by namespace
      const mcp = await mcpRepo.findByNamespace(req.params.namespace);

      if (!mcp) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_UPDATE,
          success: false,
          errorMessage: "MCP not found",
          details: { bundleId: req.params.id, namespace: req.params.namespace }
        });
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Check if MCP exists in bundle
      const bundleMcp = await bundleRepo.findMcpInBundle(
        req.params.id,
        mcp.id
      );

      if (!bundleMcp) {
        auditApiLogSession({
          action: AuditApiAction.BUNDLE_UPDATE,
          success: false,
          errorMessage: "MCP not found in bundle",
          details: { bundleId: req.params.id, namespace: req.params.namespace }
        });
        res.status(404).json({ error: "MCP not found in bundle" });
        return;
      }

      await bundleRepo.removeMcp(req.params.id, mcp.id);

      auditApiLogSession({
        action: AuditApiAction.BUNDLE_UPDATE,
        success: true,
        details: {
          bundleId: req.params.id,
          removedMcp: req.params.namespace,
          operation: "remove_mcp"
        }
      });

      logger.info(
        { bundleId: req.params.id, namespace: req.params.namespace },
        "Removed MCP from bundle"
      );

      res.status(204).send();
    } catch (error: any) {
      auditApiLogSession({
        action: AuditApiAction.BUNDLE_UPDATE,
        success: false,
        errorMessage: error.message,
        details: { bundleId: req.params.id, namespace: req.params.namespace }
      });
      logger.error({ error: error.issues.message }, 'Failed to remove MCP');
      res.status(500).json({ error: 'Failed to remove MCP' });
    }
  });


  /**
   * POST /api/bundles/:id/tokens
   * Generate a new bundle token
   */
  router.post('/:id/tokens', async (req: Request<{ id: string }, GenerateTokenResponse | ErrorResponse, GenerateTokenRequest>, res: Response<GenerateTokenResponse | ErrorResponse>): Promise<void> => {
    try {
      const data = GenerateTokenRequestSchema.parse(req.body);

      const bundle = await bundleRepo.findById(req.params.id);
      if (!bundle) {
        auditApiLogSession({
          action: AuditApiAction.TOKEN_CREATE,
          success: false,
          errorMessage: "Bundle not found",
          details: { bundleId: req.params.id }
        });
        res.status(404).json({ error: 'Bundle not found' });
        return;
      }

      const expiresAt = data.expiresAt ? new Date(data.expiresAt) : undefined;
      const { token, record } = await tokenRepo.generate(
        req.params.id,
        data.name,
        req.apiAuth!.userId,
        data.description,
        expiresAt,
      );

      auditApiLogSession({
        action: AuditApiAction.TOKEN_CREATE,
        success: true,
        details: {
          bundleId: req.params.id,
          tokenId: record.id,
          tokenName: data.name
        }
      });

      logger.info(
        { bundleId: req.params.id, tokenId: record.id, name: data.name },
        "Generated new bundle token"
      );

      res.status(201).json(GenerateTokenResponseSchema.strip().parse({ ...record, token }));

    } catch (error: any) {
      if (error instanceof z.ZodError) {
        auditApiLogSession({
          action: AuditApiAction.TOKEN_CREATE,
          success: false,
          errorMessage: "Validation error",
          details: { bundleId: req.params.id }
        });
        logger.error({
          endpoint: 'POST /api/bundles/:id/tokens',
          bundleId: req.params.id,
          error: error.issues,
          receivedData: req.body,
        }, 'Validation failed: missing or invalid token generation parameters');
        sendZodError(res, error, "Invalid token generation request");
        return;
      }

      auditApiLogSession({
        action: AuditApiAction.TOKEN_CREATE,
        success: false,
        errorMessage: error.message,
        details: { bundleId: req.params.id }
      });
      logger.error({ error: error.issues.message, bundleId: req.params.id }, 'Failed to generate token');
      res.status(500).json({ error: 'Failed to generate token' });
    }
  });

  /**
   * GET /api/bundles/:id/tokens
   * List all tokens for a bundle
   */
  router.get('/:id/tokens', async (req: Request, res: Response<ListTokenReponse | ErrorResponse>) => {
    try {
      const bundle = await bundleRepo.findById(req.params.id);
      if (!bundle) {
        auditApiLogSession({
          action: AuditApiAction.TOKEN_VIEW,
          success: false,
          errorMessage: "Bundle not found",
          details: { bundleId: req.params.id }
        });
        res.status(404).json({ error: 'Bundle not found' });
        return;
      }

      const tokens = await tokenRepo.list(req.params.id);
      const parsedTokens = tokens.map((t) => TokenResponseSchema.strip().parse(t));

      auditApiLogSession({
        action: AuditApiAction.TOKEN_VIEW,
        success: true,
        details: { bundleId: req.params.id, tokenCount: tokens.length }
      });

      res.json(ListTokenReponseSchema.parse(parsedTokens));

    } catch (error: any) {
      auditApiLogSession({
        action: AuditApiAction.TOKEN_VIEW,
        success: false,
        errorMessage: error.message,
        details: { bundleId: req.params.id }
      });
      logger.error({ error: error.issues.message }, 'Failed to list tokens');
      res.status(500).json({ error: 'Failed to list tokens' });
    }
  });

  /**
   * DELETE /api/bundles/:id/tokens/:tokenId
   * Revoke/delete a token
   */
  router.delete('/:id/tokens/:tokenId', async (req: Request, res: Response) => {
    try {
      const token = await tokenRepo.findById(req.params.tokenId);

      if (!token) {
        auditApiLogSession({
          action: AuditApiAction.TOKEN_REVOKE,
          success: false,
          errorMessage: "Token not found",
          details: { bundleId: req.params.id, tokenId: req.params.tokenId }
        });
        res.status(404).json({ error: 'Token not found' });
        return;
      }

      if (token.bundleId !== req.params.id) {
        auditApiLogSession({
          action: AuditApiAction.TOKEN_REVOKE,
          success: false,
          errorMessage: "Token does not belong to this bundle",
          details: { bundleId: req.params.id, tokenId: req.params.tokenId, actualBundleId: token.bundleId }
        });
        res.status(403).json({ error: "Token does not belong to this bundle" });
        return;
      }

      await tokenRepo.delete(req.params.tokenId);

      auditApiLogSession({
        action: AuditApiAction.TOKEN_REVOKE,
        success: true,
        details: {
          bundleId: req.params.id,
          tokenId: req.params.tokenId,
          tokenName: token.name
        }
      });

      logger.info(
        { bundleId: req.params.id, tokenId: req.params.tokenId },
        "Deleted bundle token"
      );

      res.status(204).send({ id: token.id });
    } catch (error: any) {
      auditApiLogSession({
        action: AuditApiAction.TOKEN_REVOKE,
        success: false,
        errorMessage: error.message,
        details: { bundleId: req.params.id, tokenId: req.params.tokenId }
      });
      logger.error({ error: error.issues.message }, 'Failed to delete token');
      res.status(500).json({ error: 'Failed to delete token' });
    }
  });

  return router;
}
