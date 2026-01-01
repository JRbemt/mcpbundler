/**
 * Token Routes - Bundle credential management
 *
 * Public endpoints for managing per-token MCP credentials (USER_SET auth strategy).
 *
 * Endpoints:
 * - POST   /api/bundles/:bundleToken/mcps/:namespace - Bind credentials
 * - PUT    /api/bundles/:bundleToken/mcps/:namespace - Update credentials
 * - DELETE /api/bundles/:bundleToken/mcps/:namespace - Remove credentials
 * - GET    /api/bundles/:bundleToken/mcps            - List all credentials for token
 *
 * The bundle token itself serves as authenticator - no API key required. Credentials
 * are encrypted with AES-256-GCM before storage.
 */

import express, { Request, Response, Router } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../../utils/logger.js";
import {
  BundleRepository,
  AccessTokenRepository,
  McpCredentialRepository,
  McpRepository,
} from "../database/repositories/index.js";
import { MCPAuthConfigSchema } from "../../core/config/schemas.js";
import { z } from "zod";
import { sendZodError } from "./utils/error-formatter.js";
import { ErrorResponse } from "./utils/schemas.js";
import { auditApiLog, AuditApiAction } from "../../utils/audit-log.js";

/**
 * Request/Response schemas for credential endpoints
 */

const BindCredentialRequestSchema = z.object({
  authConfig: MCPAuthConfigSchema,
});

const UpdateCredentialRequestSchema = z.object({
  authConfig: MCPAuthConfigSchema,
});

const CredentialResponseSchema = z.object({
  credentialId: z.string(),
  mcpNamespace: z.string(),
  createdAt: z.date(),
  updatedAt: z.date()
});

const CredentialListItemSchema = z.object({
  credentialId: z.string(),
  mcpNamespace: z.string(),
  mcpUrl: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});


export type BindCredentialRequest = z.infer<typeof BindCredentialRequestSchema>;
export type UpdateCredentialRequest = z.infer<typeof UpdateCredentialRequestSchema>;
export type CredentialResponse = z.infer<typeof CredentialResponseSchema>;
export type CredentialListItem = z.infer<typeof CredentialListItemSchema>;

export function createBundleTokenRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const bundleRepo = new BundleRepository(prisma);
  const tokenRepo = new AccessTokenRepository(prisma);
  const mcpCredRepo = new McpCredentialRepository(prisma);
  const mcpRepo = new McpRepository(prisma);

  /**
   * Validate and resolve bundle token
   *
   * @param bundleToken Plaintext bundle access token
   * @returns Token record or null if invalid
   */
  async function validateBundleToken(bundleToken: string) {
    const token = await tokenRepo.findByToken(bundleToken);
    if (!token || !tokenRepo.isValid(token)) {
      return null;
    }
    return token;
  }

  /**
   * POST /api/tokens/:bundleToken/mcps/:namespace
   * Bind credentials to a token+MCP combination
   */
  router.post('/:bundleToken/mcps/:namespace', async (req: Request<{ bundleToken: string; namespace: string }, CredentialResponse | ErrorResponse, BindCredentialRequest>, res: Response<CredentialResponse | ErrorResponse>): Promise<void> => {
    try {
      const { bundleToken, namespace } = req.params;

      // Validate bundle token
      const token = await validateBundleToken(bundleToken);
      if (!token) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_BIND,
          success: false,
          errorMessage: "Invalid or expired bundle token",
          details: { namespace }
        }, req);
        res.status(401).json({ error: 'Invalid or expired bundle token' });
        return;
      }

      // Validate request body
      const data = BindCredentialRequestSchema.parse(req.body);

      // Find MCP by namespace
      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_BIND,
          success: false,
          errorMessage: "MCP not found",
          details: { namespace, bundleId: token.bundleId }
        }, req);
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Verify MCP is in the bundle
      const bundleMcp = await bundleRepo.findMcpInBundle(
        token.bundleId,
        mcp.id
      );
      if (!bundleMcp) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_BIND,
          success: false,
          errorMessage: "MCP not in bundle",
          details: { namespace, bundleId: token.bundleId, mcpId: mcp.id }
        }, req);
        res.status(404).json({ error: "MCP not found in bundle" });
        return;
      }

      // Check if credentials already exist
      const existing = await mcpCredRepo.findByTokenAndMcp(token.id, mcp.id);
      if (existing) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_BIND,
          success: false,
          errorMessage: "Credentials already exist",
          details: { namespace, bundleId: token.bundleId, mcpId: mcp.id }
        }, req);
        res.status(409).json({ error: 'Credentials already exist for this token+MCP' });
        return;
      }

      // Bind credentials
      const credential = await mcpCredRepo.bind(
        token.id,
        mcp.id,
        data.authConfig
      );

      auditApiLog({
        action: AuditApiAction.CREDENTIAL_BIND,
        success: true,
        details: {
          namespace,
          bundleId: token.bundleId,
          mcpId: mcp.id,
          credentialId: credential.id,
          authMethod: data.authConfig.method
        }
      }, req);

      logger.info(
        { tokenId: token.id, namespace, mcpId: mcp.id },
        'Bound credentials to token+MCP'
      );

      res.status(201).json(
        CredentialResponseSchema.strip().parse({
          credentialId: credential.id,
          mcpNamespace: namespace,
          createdAt: credential.createdAt,
        })
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_BIND,
          success: false,
          errorMessage: "Validation error",
          details: { namespace: req.params.namespace }
        }, req);
        logger.error({
          endpoint: 'POST /api/tokens/:bundleToken/mcps/:namespace',
          bundleToken: req.params.bundleToken,
          namespace: req.params.namespace,
          error: error.issues,
          receivedData: req.body,
        }, 'Validation failed: missing or invalid parameters');
        sendZodError(res, error, "Invalid credential data");
        return;
      }

      auditApiLog({
        action: AuditApiAction.CREDENTIAL_BIND,
        success: false,
        errorMessage: error.message,
        details: { namespace: req.params.namespace }
      }, req);
      logger.error({ error: error.issues.message, bundleToken: req.params.bundleToken, namespace: req.params.namespace }, 'Failed to bind credentials');
      res.status(500).json({ error: 'Failed to bind credentials' });
    }
  });

  /**
   * PUT /api/tokens/:bundleToken/mcps/:namespace
   * Update credentials for a token+MCP combination
   */
  router.put('/:bundleToken/mcps/:namespace', async (req: Request<{ bundleToken: string; namespace: string }, CredentialResponse | ErrorResponse, UpdateCredentialRequest>, res: Response<CredentialResponse | ErrorResponse>): Promise<void> => {
    try {
      const { bundleToken, namespace } = req.params;

      // Validate bundle token
      const token = await validateBundleToken(bundleToken);
      if (!token) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_UPDATE,
          success: false,
          errorMessage: "Invalid or expired bundle token",
          details: { namespace }
        }, req);
        res.status(401).json({ error: 'Invalid or expired bundle token' });
        return;
      }

      // Validate request body
      const data = UpdateCredentialRequestSchema.parse(req.body);

      // Find MCP by namespace
      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_UPDATE,
          success: false,
          errorMessage: "MCP not found",
          details: { namespace, bundleId: token.bundleId }
        }, req);
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Check if credentials exist
      const existing = await mcpCredRepo.findByTokenAndMcp(token.id, mcp.id);
      if (!existing) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_UPDATE,
          success: false,
          errorMessage: "Credentials not found",
          details: { namespace, bundleId: token.bundleId, mcpId: mcp.id }
        }, req);
        res.status(404).json({ error: 'Credentials not found for this token+MCP' });
        return;
      }

      // Update credentials
      const credential = await mcpCredRepo.update(
        token.id,
        mcp.id,
        data.authConfig
      );

      auditApiLog({
        action: AuditApiAction.CREDENTIAL_UPDATE,
        success: true,
        details: {
          namespace,
          bundleId: token.bundleId,
          mcpId: mcp.id,
          credentialId: credential.id,
          authMethod: data.authConfig.method
        }
      }, req);

      logger.info(
        { tokenId: token.id, namespace, mcpId: mcp.id },
        'Updated credentials for token+MCP'
      );

      res.json(
        CredentialResponseSchema.strip().parse({
          credentialId: credential.id,
          mcpNamespace: namespace,
          updatedAt: credential.updatedAt,
        })
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_UPDATE,
          success: false,
          errorMessage: "Validation error",
          details: { namespace: req.params.namespace }
        }, req);
        logger.error({
          endpoint: 'PUT /api/tokens/:bundleToken/mcps/:namespace',
          bundleToken: req.params.bundleToken,
          namespace: req.params.namespace,
          error: error.issues,
          receivedData: req.body,
        }, 'Validation failed: missing or invalid parameters');
        sendZodError(res, error, "Invalid credential data");
        return;
      }

      auditApiLog({
        action: AuditApiAction.CREDENTIAL_UPDATE,
        success: false,
        errorMessage: error.message,
        details: { namespace: req.params.namespace }
      }, req);
      logger.error({ error: error.issues.message, bundleToken: req.params.bundleToken, namespace: req.params.namespace }, 'Failed to update credentials');
      res.status(500).json({ error: 'Failed to update credentials' });
    }
  });

  /**
   * DELETE /api/tokens/:bundleToken/mcps/:namespace
   * Remove credentials for a token+MCP combination
   */
  router.delete('/:bundleToken/mcps/:namespace', async (req: Request<{ bundleToken: string; namespace: string }>, res: Response<ErrorResponse | void>): Promise<void> => {
    try {
      const { bundleToken, namespace } = req.params;

      // Validate bundle token
      const token = await validateBundleToken(bundleToken);
      if (!token) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_DELETE,
          success: false,
          errorMessage: "Invalid or expired bundle token",
          details: { namespace }
        }, req);
        res.status(401).json({ error: 'Invalid or expired bundle token' });
        return;
      }

      // Find MCP by namespace
      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_DELETE,
          success: false,
          errorMessage: "MCP not found",
          details: { namespace, bundleId: token.bundleId }
        }, req);
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Check if credentials exist
      const existing = await mcpCredRepo.findByTokenAndMcp(token.id, mcp.id);
      if (!existing) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_DELETE,
          success: false,
          errorMessage: "Credentials not found",
          details: { namespace, bundleId: token.bundleId, mcpId: mcp.id }
        }, req);
        res.status(404).json({ error: 'Credentials not found for this token+MCP' });
        return;
      }

      // Remove credentials
      await mcpCredRepo.remove(token.id, mcp.id);

      auditApiLog({
        action: AuditApiAction.CREDENTIAL_DELETE,
        success: true,
        details: {
          namespace,
          bundleId: token.bundleId,
          mcpId: mcp.id,
          credentialId: existing.id
        }
      }, req);

      logger.info(
        { tokenId: token.id, namespace, mcpId: mcp.id },
        'Removed credentials for token+MCP'
      );

      res.status(204).send();
    } catch (error: any) {
      auditApiLog({
        action: AuditApiAction.CREDENTIAL_DELETE,
        success: false,
        errorMessage: error.message,
        details: { namespace: req.params.namespace }
      }, req);
      logger.error({ error: error.issues.message, bundleToken: req.params.bundleToken, namespace: req.params.namespace }, 'Failed to remove credentials');
      res.status(500).json({ error: 'Failed to remove credentials' });
    }
  });

  /**
   * GET /api/tokens/:bundleToken/mcps
   * List all MCP credentials for a bundle access token
   */
  router.get('/:bundleToken/mcps', async (req: Request<{ bundleToken: string }>, res: Response<CredentialListItem[] | ErrorResponse>): Promise<void> => {
    try {
      const { bundleToken } = req.params;

      // Validate bundle token
      const token = await validateBundleToken(bundleToken);
      if (!token) {
        auditApiLog({
          action: AuditApiAction.CREDENTIAL_DECRYPT,
          success: false,
          errorMessage: "Invalid or expired bundle token",
          details: {}
        }, req);
        res.status(401).json({ error: 'Invalid or expired bundle token' });
        return;
      }

      const credentials = await mcpCredRepo.listByToken(token.id);

      auditApiLog({
        action: AuditApiAction.CREDENTIAL_DECRYPT,
        success: true,
        details: {
          bundleId: token.bundleId,
          credentialCount: credentials.length,
          namespaces: credentials.map(c => c.mcp.namespace)
        }
      }, req);

      res.json(
        credentials.map((cred) => CredentialListItemSchema.strip().parse({
          credentialId: cred.id,
          mcpNamespace: cred.mcp.namespace,
          mcpUrl: cred.mcp.url,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        }))
      );
    } catch (error: any) {
      auditApiLog({
        action: AuditApiAction.CREDENTIAL_DECRYPT,
        success: false,
        errorMessage: error.message,
        details: {}
      }, req);
      logger.error({ error: error.issues.message, bundleToken: req.params.bundleToken }, 'Failed to list credentials');
      res.status(500).json({ error: 'Failed to list credentials' });
    }
  });

  return router;
}
