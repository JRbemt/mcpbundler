/**
 * Credential Routes - Bundle credential management
 *
 * Public endpoints for managing per-token MCP credentials (USER_SET auth strategy).
 *
 * Endpoints:
 * - POST   /api/credentials/:namespace - Bind credentials
 * - PUT    /api/credentials/:namespace - Update credentials
 * - DELETE /api/credentials/:namespace - Remove credentials
 * - GET    /api/credentials            - List all credentials for token
 *
 * Authentication: X-bundle-token header (distinct from Authorization which is for API keys)
 * Credentials are encrypted with AES-256-GCM before storage.
 */

import express, { Request, Response, Router, NextFunction } from "express";
import { PrismaClient, BundleAccessToken } from "@prisma/client";
import logger from "../../shared/utils/logger.js";
import {
  BundleRepository,
  BundleTokenRepository,
  McpCredentialRepository,
  McpRepository,
} from "../../shared/infra/repository/index.js";
import { AuditApiAction } from "../../shared/utils/audit-log.js";
import {
  validatedHandler,
  asyncHandler,
  sendNotFound,
  sendConflict,
} from "./utils/route-utils.js";
import {
  BindCredentialRequestSchema,
  UpdateCredentialRequestSchema,
  CredentialResponseSchema,
  CredentialListResponseSchema,
  CredentialResponse,
  CredentialListItem,
} from "./utils/credential-schemas.js";

// Re-export types
export type { CredentialResponse, CredentialListItem };

// Extend Express Request to include bundleToken
declare global {
  namespace Express {
    interface Request {
      bundleToken?: BundleAccessToken;
    }
  }
}

export function createCredentialRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const bundleRepo = new BundleRepository(prisma);
  const tokenRepo = new BundleTokenRepository(prisma);
  const mcpCredRepo = new McpCredentialRepository(prisma);
  const mcpRepo = new McpRepository(prisma);

  /**
   * Middleware: Extract and validate bundle token from X-Bundle-Token header
   */
  async function requireBundleToken(req: Request, res: Response, next: NextFunction) {
    const bundleToken = req.headers["x-bundle-token"];

    if (!bundleToken || typeof bundleToken !== "string") {
      res.status(401).json({ error: "Missing X-Bundle-Token header" });
      return;
    }

    const token = await tokenRepo.findByToken(bundleToken);

    if (!token || !tokenRepo.isValid(token)) {
      res.status(401).json({ error: "Invalid or expired bundle token" });
      return;
    }

    req.bundleToken = token;
    next();
  }

  // Apply bundle token auth to all routes
  router.use(requireBundleToken);

  /**
   * POST /api/credentials/:namespace
   * Bind credentials to a token+MCP combination
   */
  router.post("/:namespace", ...validatedHandler(
    BindCredentialRequestSchema,
    CredentialResponseSchema,
    async (req, res, data) => {
      const { namespace } = req.params;
      const token = req.bundleToken!;

      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        return sendNotFound(res, "MCP", req, AuditApiAction.CREDENTIAL_BIND, { namespace });
      }

      const bundleMcp = await bundleRepo.findMcpInBundle(token.bundleId, mcp.id);
      if (!bundleMcp) {
        return sendNotFound(res, "MCP in bundle", req, AuditApiAction.CREDENTIAL_BIND, {
          namespace,
          bundleId: token.bundleId,
        });
      }

      const existing = await mcpCredRepo.findByTokenAndMcp(token.id, mcp.id);
      if (existing) {
        return sendConflict(
          res,
          "Credentials already exist for this token+MCP",
          req,
          AuditApiAction.CREDENTIAL_BIND,
          { namespace, bundleId: token.bundleId }
        );
      }

      const credential = await mcpCredRepo.bind(token.id, mcp.id, data.authConfig);

      logger.info({ tokenId: token.id, namespace, mcpId: mcp.id }, "Bound credentials to token+MCP");

      return {
        credentialId: credential.id,
        mcpNamespace: namespace,
        createdAt: credential.createdAt.toISOString(),
      };
    },
    {
      action: AuditApiAction.CREDENTIAL_BIND,
      successStatus: 201,
      errorMessage: "Failed to bind credentials",
      getAuditDetails: (req, result) => ({
        namespace: req.params.namespace,
        credentialId: result?.credentialId,
      }),
    }
  ));

  /**
   * PUT /api/credentials/:namespace
   * Update credentials for a token+MCP combination
   */
  router.put("/:namespace", ...validatedHandler(
    UpdateCredentialRequestSchema,
    CredentialResponseSchema,
    async (req, res, data) => {
      const { namespace } = req.params;
      const token = req.bundleToken!;

      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        return sendNotFound(res, "MCP", req, AuditApiAction.CREDENTIAL_UPDATE, { namespace });
      }

      const existing = await mcpCredRepo.findByTokenAndMcp(token.id, mcp.id);
      if (!existing) {
        return sendNotFound(res, "Credentials for this token+MCP", req, AuditApiAction.CREDENTIAL_UPDATE, {
          namespace,
          bundleId: token.bundleId,
        });
      }

      const credential = await mcpCredRepo.updateByTokenAndMcp(token.id, mcp.id, data.authConfig);

      logger.info({ tokenId: token.id, namespace, mcpId: mcp.id }, "Updated credentials for token+MCP");

      return {
        credentialId: credential.id,
        mcpNamespace: namespace,
        updatedAt: credential.updatedAt.toISOString(),
      };
    },
    {
      action: AuditApiAction.CREDENTIAL_UPDATE,
      errorMessage: "Failed to update credentials",
      getAuditDetails: (req, result) => ({
        namespace: req.params.namespace,
        credentialId: result?.credentialId,
      }),
    }
  ));

  /**
   * DELETE /api/credentials/:namespace
   * Remove credentials for a token+MCP combination
   */
  router.delete("/:namespace", asyncHandler(
    null,
    async (req, res) => {
      const { namespace } = req.params;
      const token = req.bundleToken!;

      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        return sendNotFound(res, "MCP", req, AuditApiAction.CREDENTIAL_DELETE, { namespace });
      }

      const existing = await mcpCredRepo.findByTokenAndMcp(token.id, mcp.id);
      if (!existing) {
        return sendNotFound(res, "Credentials for this token+MCP", req, AuditApiAction.CREDENTIAL_DELETE, {
          namespace,
          bundleId: token.bundleId,
        });
      }

      await mcpCredRepo.remove(token.id, mcp.id);

      logger.info({ tokenId: token.id, namespace, mcpId: mcp.id }, "Removed credentials for token+MCP");
    },
    {
      action: AuditApiAction.CREDENTIAL_DELETE,
      successStatus: 204,
      errorMessage: "Failed to remove credentials",
      getAuditDetails: (req) => ({ namespace: req.params.namespace }),
    }
  ));

  /**
   * GET /api/credentials
   * List all MCP credentials for the authenticated bundle token
   */
  router.get("/", asyncHandler(
    CredentialListResponseSchema,
    async (req, _res) => {
      const token = req.bundleToken!;

      const credentials = await mcpCredRepo.listByToken(token.id);

      return credentials.map((cred) => ({
        credentialId: cred.id,
        mcpNamespace: cred.mcp.namespace,
        mcpUrl: cred.mcp.url,
        createdAt: cred.createdAt.toISOString(),
        updatedAt: cred.updatedAt.toISOString(),
      }));
    },
    {
      action: AuditApiAction.CREDENTIAL_DECRYPT,
      errorMessage: "Failed to list credentials",
      getAuditDetails: (req, result) => ({
        tokenId: req.bundleToken?.id,
        credentialCount: result?.length ?? 0,
      }),
    }
  ));

  return router;
}
