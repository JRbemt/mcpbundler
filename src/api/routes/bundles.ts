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
import { PrismaClient } from "../../shared/domain/entities.js";
import {
  BundleTokenRepository,
  ApiUserRepository,
  BundleRepository,
  McpRepository,
} from "../../shared/infra/repository/index.js";
import { validatedHandler, sendNotFound, sendForbidden, validatedBodyHandler } from "./utils/route-utils.js";
import { MCPResponseSchema, McpResponse } from "./utils/mcp-schemas.js";
import {
  CreateBundleRequestSchema,
  GenerateTokenRequestSchema,
  AddMcpsByNamespaceRequestSchema,
  BundleResponseSchema,
  CreateBundleResponseSchema,
  ListTokenResponseSchema,
  GenerateTokenResponseSchema,
  AddMcpByNamespaceResponseSchema,
  BundleResponse,
  CreateBundleResponse,
  GenerateTokenResponse,
  ListTokenResponse,
  AddMcpByNamespaceResponse,
  CreateBundleRequest,
  GenerateTokenRequest,
  AddMcpsByNamespaceRequest,
} from "./utils/bundle-schemas.js";
import { AuditApiAction } from "../../shared/utils/audit-log.js";
import logger from "../../shared/utils/logger.js";
import { BundleWithMcpsAndCreator } from "../../shared/infra/repository/BundleRepository.js";

/**
 * Transform bundle with MCPs from database format to API response format
 * Parses JSON permission strings into objects
 */
function toBundleResponse(bundle: BundleWithMcpsAndCreator): BundleResponse {
  return {
    id: bundle.id,
    name: bundle.name,
    description: bundle.description,
    createdAt: bundle.createdAt,
    createdBy: bundle.createdBy,
    mcps: bundle.mcps.map((entry) => ({
      ...entry.mcp,
      permissions: {
        allowedTools: JSON.parse(entry.allowedTools),
        allowedResources: JSON.parse(entry.allowedResources),
        allowedPrompts: JSON.parse(entry.allowedPrompts),
      },
    })),
  };
}

// Re-export types for backwards compatibility
export type {
  CreateBundleRequest,
  GenerateTokenRequest,
  AddMcpsByNamespaceRequest,
  CreateBundleResponse,
  GenerateTokenResponse,
  BundleResponse,
  ListTokenResponse,
  AddMcpByNamespaceResponse,
};

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
  const tokenRepo = new BundleTokenRepository(prisma);
  const userRepo = new ApiUserRepository(prisma);

  /**
    * GET /api/bundles
    * List all bundles
    */
  router.get(
    "/",
    validatedHandler(
      BundleResponseSchema.array(),
      async () => {
        const bundles = await bundleRepo.list();
        return bundles.map(toBundleResponse);
      },
      {
        action: AuditApiAction.BUNDLE_VIEW,
        errorMessage: "Failed to list bundles",
        getAuditDetails: (_req, result) => ({
          scope: "all",
          count: result?.length,
        }),
      }
    )
  );

  /**
   * GET /api/bundles/me
   * List bundles created by user or descendants
   */
  router.get(
    "/me",
    validatedHandler(
      BundleResponseSchema.array(),
      async (req) => {
        const descendantIds = await userRepo.collectDescendantIds(req.apiAuth!.userId);
        const ids = [req.apiAuth!.userId, ...descendantIds];
        const bundles = await bundleRepo.listByCreators(ids);
        return bundles.map(toBundleResponse);
      },
      {
        action: AuditApiAction.BUNDLE_VIEW,
        errorMessage: "Failed to list bundles",
        getAuditDetails: (_req, result) => ({
          scope: "user_hierarchy",
          count: result?.length,
        }),
      }
    )
  );

  /**
   * GET /api/bundles/:id
   */
  router.get(
    "/:id",
    validatedHandler(
      BundleResponseSchema,
      async (req: Request<{ id: string }>, res) => {
        const bundle = await bundleRepo.findById(req.params.id);
        if (!bundle) {
          return sendNotFound(res, "Bundle", req, AuditApiAction.BUNDLE_VIEW, {
            bundleId: req.params.id,
          });
        }

        return toBundleResponse(bundle);
      },
      {
        action: AuditApiAction.BUNDLE_VIEW,
        errorMessage: "Failed to get bundle",
        getAuditDetails: (req, result) => ({
          bundleId: req.params.id,
          mcpCount: result?.mcps.length,
        }),
      }
    )
  );

  /**
   * POST /api/bundles
   */
  router.post(
    "/",
    ...validatedBodyHandler(
      CreateBundleRequestSchema,
      CreateBundleResponseSchema,
      async (req, _res, data: CreateBundleRequest) => {
        const createdById = req.apiAuth?.userId ?? null;
        const { record } = await bundleRepo.create({
          name: data.name,
          description: data.description,
          createdById,
        });

        logger.info({ bundleId: record.id }, "Created bundle");
        return record;
      },
      {
        action: AuditApiAction.BUNDLE_CREATE,
        successStatus: 201,
        errorMessage: "Failed to create bundle",
        getAuditDetails: (_req, result) => ({
          bundleId: result?.id,
        }),
      }
    )
  );

  /**
   * DELETE /api/bundles/:id
   */
  router.delete(
    "/:id",
    validatedHandler(
      null,
      async (req: Request<{ id: string }>, res) => {
        const bundle = await bundleRepo.findById(req.params.id);
        if (!bundle) {
          return sendNotFound(res, "Bundle", req, AuditApiAction.BUNDLE_DELETE, {
            bundleId: req.params.id,
          });
        }

        if (!(await userRepo.isAuthorized(req.apiAuth!.userId, bundle))) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.BUNDLE_DELETE,
            "You can only delete bundles you created or that were created by users you created",
            { bundleId: req.params.id }
          );
        }

        await bundleRepo.delete(req.params.id);
        logger.info({ bundleId: req.params.id }, "Deleted bundle");

        return null;
      },
      {
        action: AuditApiAction.BUNDLE_DELETE,
        successStatus: 204,
        errorMessage: "Failed to delete bundle",
        getAuditDetails: (req) => ({ bundleId: req.params.id }),
      }
    )
  );

  /**
   * POST /api/bundles/:id
   * Add MCP(s) by namespace
   */
  router.post(
    "/:id",
    ...validatedBodyHandler(
      AddMcpsByNamespaceRequestSchema,
      AddMcpByNamespaceResponseSchema,
      async (req: Request<{ id: string }>, res, data: AddMcpsByNamespaceRequest) => {
        const bundle = await bundleRepo.findById(req.params.id);
        if (!bundle) {
          return sendNotFound(res, "Bundle", req, AuditApiAction.BUNDLE_UPDATE, {
            bundleId: req.params.id,
          });
        }

        if (!(await userRepo.isAuthorized(req.apiAuth!.userId, bundle))) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.BUNDLE_UPDATE,
            "You can only modify bundles you created or that were created by users you created",
            { bundleId: req.params.id }
          );
        }

        const requests = Array.isArray(data) ? data : [data];
        const added: McpResponse[] = [];
        const errors: Array<{ namespace: string; reason: string }> = [];

        for (const reqMcp of requests) {
          const mcp = await mcpRepo.findByNamespace(reqMcp.namespace);
          if (!mcp) {
            errors.push({ namespace: reqMcp.namespace, reason: "MCP not found in master registry" });
            continue;
          }

          const exists = await bundleRepo.findMcpInBundle(req.params.id, mcp.id);
          if (exists) {
            errors.push({ namespace: reqMcp.namespace, reason: "Already exists in bundle" });
            continue;
          }

          await bundleRepo.addMcp(req.params.id, mcp.id, reqMcp.permissions);
          added.push(MCPResponseSchema.strip().parse(mcp));
        }

        if (errors.length > 0) {
          return {
            added,
            errors,
          };
        }

        return { added };
      },
      {
        action: AuditApiAction.BUNDLE_UPDATE,
        successStatus: 207,
        errorMessage: "Failed to add MCP(s)",
        getAuditDetails: (req, result: AddMcpByNamespaceResponse | undefined) => ({
          bundleId: req.params.id,
          addedCount: result?.added.length,
          errors: result?.errors?.length,
        }),
      }
    )
  );

  /**
   * DELETE /api/bundles/:id/:namespace
   */
  router.delete(
    "/:id/:namespace",
    validatedHandler(
      null,
      async (req: Request<{ id: string; namespace: string }>, res) => {
        const bundle = await bundleRepo.findById(req.params.id);
        if (!bundle) {
          return sendNotFound(res, "Bundle", req, AuditApiAction.BUNDLE_UPDATE, {
            bundleId: req.params.id,
          });
        }

        if (!(await userRepo.isAuthorized(req.apiAuth!.userId, bundle))) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.BUNDLE_UPDATE,
            "You can only modify bundles you created or that were created by users you created",
            { bundleId: req.params.id }
          );
        }

        const mcp = await mcpRepo.findByNamespace(req.params.namespace);
        if (!mcp) {
          return sendNotFound(res, "MCP", req, AuditApiAction.BUNDLE_UPDATE, {
            namespace: req.params.namespace,
          });
        }

        const bundleMcp = await bundleRepo.findMcpInBundle(req.params.id, mcp.id);
        if (!bundleMcp) {
          return sendNotFound(res, "MCP in bundle", req, AuditApiAction.BUNDLE_UPDATE, {
            namespace: req.params.namespace,
          });
        }

        await bundleRepo.removeMcp(req.params.id, mcp.id);
        logger.info({ bundleId: req.params.id, namespace: req.params.namespace }, "Removed MCP");

        return null;
      },
      {
        action: AuditApiAction.BUNDLE_UPDATE,
        successStatus: 204,
        errorMessage: "Failed to remove MCP",
        getAuditDetails: (req) => ({
          bundleId: req.params.id,
          namespace: req.params.namespace,
        }),
      }
    )
  );

  /**
   * POST /api/bundles/:id/tokens
   */
  router.post(
    "/:id/tokens",
    ...validatedBodyHandler(
      GenerateTokenRequestSchema,
      GenerateTokenResponseSchema,
      async (req: Request<{ id: string }>, res, data: GenerateTokenRequest) => {
        const bundle = await bundleRepo.findById(req.params.id);
        if (!bundle) {
          return sendNotFound(res, "Bundle", req, AuditApiAction.TOKEN_CREATE, {
            bundleId: req.params.id,
          });
        }

        const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
        const { record, token } = await tokenRepo.create({
          bundleId: req.params.id,
          name: data.name,
          description: data.description ?? null,
          createdById: req.apiAuth!.userId,
          expiresAt,
          revoked: false,
          lastUsedAt: null,
        });

        logger.info({ bundleId: req.params.id, tokenId: record.id }, "Generated token");
        return { ...record, token };
      },
      {
        action: AuditApiAction.TOKEN_CREATE,
        successStatus: 201,
        errorMessage: "Failed to generate token",
        getAuditDetails: (_req, result) => ({
          tokenId: result?.id,
        }),
      }
    )
  );

  /**
   * GET /api/bundles/:id/tokens
   */
  router.get(
    "/:id/tokens",
    validatedHandler(
      ListTokenResponseSchema,
      async (req: Request<{ id: string }>, res) => {
        const bundle = await bundleRepo.findById(req.params.id);
        if (!bundle) {
          return sendNotFound(res, "Bundle", req, AuditApiAction.TOKEN_VIEW, {
            bundleId: req.params.id,
          });
        }

        const tokens = await tokenRepo.list(req.params.id);
        return tokens;
      },
      {
        action: AuditApiAction.TOKEN_VIEW,
        errorMessage: "Failed to list tokens",
        getAuditDetails: (_req, result) => ({
          tokenCount: result?.length,
        }),
      }
    )
  );

  /**
   * DELETE /api/bundles/:id/tokens/:tokenId
   */
  router.delete(
    "/:id/tokens/:tokenId",
    validatedHandler(
      null,
      async (req: Request<{ id: string; tokenId: string }>, res) => {
        const token = await tokenRepo.findById(req.params.tokenId);
        if (!token) {
          return sendNotFound(res, "Token", req, AuditApiAction.TOKEN_REVOKE, {
            tokenId: req.params.tokenId,
          });
        }

        if (token.bundleId !== req.params.id) {
          return sendForbidden(
            res,
            req,
            AuditApiAction.TOKEN_REVOKE,
            "Token does not belong to this bundle",
            { tokenId: req.params.tokenId }
          );
        }

        await tokenRepo.delete(req.params.tokenId);
        logger.info({ tokenId: req.params.tokenId }, "Revoked token");

        return null;
      },
      {
        action: AuditApiAction.TOKEN_REVOKE,
        successStatus: 204,
        errorMessage: "Failed to revoke token",
        getAuditDetails: (req) => ({
          bundleId: req.params.id,
          tokenId: req.params.tokenId,
        }),
      }
    )
  );

  return router;
}
