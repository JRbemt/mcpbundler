import express, { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../../utils/logger.js';
import {
  CollectionRepository,
  AccessTokenRepository,
  McpCredentialRepository,
  McpRepository,
} from '../database/repositories/index.js';
import { UpstreamAuthConfigSchema } from '../../config/schemas.js';
import { z } from 'zod';

export function createTokenRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const collectionRepo = new CollectionRepository(prisma);
  const tokenRepo = new AccessTokenRepository(prisma);
  const mcpCredRepo = new McpCredentialRepository(prisma);
  const mcpRepo = new McpRepository(prisma);

  /**
   * POST /api/collections/:id/tokens
   * Generate a new collection token
   */
  router.post('/:id/tokens', async (req: Request, res: Response) => {
    try {
      const { name, description, expires_at } = req.body;

      if (!name) {
        res.status(400).json({ error: 'Token name is required' });
        return;
      }

      const collection = await collectionRepo.findById(req.params.id);
      if (!collection) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }

      const expiresAt = expires_at ? new Date(expires_at) : undefined;
      const { token, record } = await tokenRepo.generate(
        req.params.id,
        name,
        description,
        expiresAt
      );

      logger.info(
        { collectionId: req.params.id, tokenId: record.id, name },
        'Generated new collection token'
      );

      res.status(201).json({
        token,  // Return plain token ONLY on creation
        token_id: record.id,
        name: record.name,
        description: record.description,
        expires_at: record.expiresAt,
        created_at: record.createdAt,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to generate token');
      res.status(500).json({ error: 'Failed to generate token' });
    }
  });

  /**
   * GET /api/collections/:id/tokens
   * List all tokens for a collection
   */
  router.get('/:id/tokens', async (req: Request, res: Response) => {
    try {
      const collection = await collectionRepo.findById(req.params.id);
      if (!collection) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }

      const tokens = await tokenRepo.list(req.params.id);

      res.json(
        tokens.map((t) => ({
          token_id: t.id,
          name: t.name,
          description: t.description,
          revoked: t.revoked,
          expires_at: t.expiresAt,
          created_at: t.createdAt,
        }))
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list tokens');
      res.status(500).json({ error: 'Failed to list tokens' });
    }
  });

  /**
   * DELETE /api/collections/:id/tokens/:tokenId
   * Revoke/delete a token
   */
  router.delete('/:id/tokens/:tokenId', async (req: Request, res: Response) => {
    try {
      const token = await tokenRepo.findById(req.params.tokenId);

      if (!token) {
        res.status(404).json({ error: 'Token not found' });
        return;
      }

      if (token.collectionId !== req.params.id) {
        res.status(403).json({ error: 'Token does not belong to this collection' });
        return;
      }

      await tokenRepo.delete(req.params.tokenId);

      logger.info(
        { collectionId: req.params.id, tokenId: req.params.tokenId },
        'Deleted collection token'
      );

      res.status(204).send();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to delete token');
      res.status(500).json({ error: 'Failed to delete token' });
    }
  });

  /**
   * POST /api/tokens/:tokenId/mcps/:namespace/credentials
   * Bind credentials to a token+MCP combination
   */
  router.post('/:tokenId/mcps/:namespace/credentials', async (req: Request, res: Response) => {
    try {
      const { tokenId, namespace } = req.params;

      // Validate token exists
      const token = await tokenRepo.findById(tokenId);
      if (!token || !tokenRepo.isValid(token)) {
        res.status(404).json({ error: 'Token not found or invalid' });
        return;
      }

      // Validate auth config
      const authConfigResult = UpstreamAuthConfigSchema.safeParse(req.body.auth_config);
      if (!authConfigResult.success) {
        res.status(400).json({
          error: 'Invalid auth config',
          details: authConfigResult.error.errors
        });
        return;
      }

      // Find MCP by namespace
      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Verify MCP is in the collection
      const collectionMcp = await collectionRepo.findMcpInCollection(
        token.collectionId,
        mcp.id
      );
      if (!collectionMcp) {
        res.status(404).json({ error: 'MCP not found in collection' });
        return;
      }

      // Check if credentials already exist
      const existing = await mcpCredRepo.findByTokenAndMcp(tokenId, mcp.id);
      if (existing) {
        res.status(409).json({ error: 'Credentials already exist for this token+MCP' });
        return;
      }

      // Bind credentials
      const credential = await mcpCredRepo.bind(
        tokenId,
        mcp.id,
        authConfigResult.data
      );

      logger.info(
        { tokenId, namespace, mcpId: mcp.id },
        'Bound credentials to token+MCP'
      );

      res.status(201).json({
        credential_id: credential.id,
        token_id: credential.tokenId,
        mcp_namespace: namespace,
        created_at: credential.createdAt,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to bind credentials');
      res.status(500).json({ error: 'Failed to bind credentials' });
    }
  });

  /**
   * PUT /api/tokens/:tokenId/mcps/:namespace/credentials
   * Update credentials for a token+MCP combination
   */
  router.put('/:tokenId/mcps/:namespace/credentials', async (req: Request, res: Response) => {
    try {
      const { tokenId, namespace } = req.params;

      // Validate token exists
      const token = await tokenRepo.findById(tokenId);
      if (!token || !tokenRepo.isValid(token)) {
        res.status(404).json({ error: 'Token not found or invalid' });
        return;
      }

      // Validate auth config
      const authConfigResult = UpstreamAuthConfigSchema.safeParse(req.body.auth_config);
      if (!authConfigResult.success) {
        res.status(400).json({
          error: 'Invalid auth config',
          details: authConfigResult.error.errors
        });
        return;
      }

      // Find MCP by namespace
      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Check if credentials exist
      const existing = await mcpCredRepo.findByTokenAndMcp(tokenId, mcp.id);
      if (!existing) {
        res.status(404).json({ error: 'Credentials not found for this token+MCP' });
        return;
      }

      // Update credentials
      const credential = await mcpCredRepo.update(
        tokenId,
        mcp.id,
        authConfigResult.data
      );

      logger.info(
        { tokenId, namespace, mcpId: mcp.id },
        'Updated credentials for token+MCP'
      );

      res.json({
        credential_id: credential.id,
        token_id: credential.tokenId,
        mcp_namespace: namespace,
        updated_at: credential.updatedAt,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to update credentials');
      res.status(500).json({ error: 'Failed to update credentials' });
    }
  });

  /**
   * DELETE /api/tokens/:tokenId/mcps/:namespace/credentials
   * Remove credentials for a token+MCP combination
   */
  router.delete('/:tokenId/mcps/:namespace/credentials', async (req: Request, res: Response) => {
    try {
      const { tokenId, namespace } = req.params;

      // Validate token exists
      const token = await tokenRepo.findById(tokenId);
      if (!token) {
        res.status(404).json({ error: 'Token not found' });
        return;
      }

      // Find MCP by namespace
      const mcp = await mcpRepo.findByNamespace(namespace);
      if (!mcp) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Check if credentials exist
      const existing = await mcpCredRepo.findByTokenAndMcp(tokenId, mcp.id);
      if (!existing) {
        res.status(404).json({ error: 'Credentials not found for this token+MCP' });
        return;
      }

      // Remove credentials
      await mcpCredRepo.remove(tokenId, mcp.id);

      logger.info(
        { tokenId, namespace, mcpId: mcp.id },
        'Removed credentials for token+MCP'
      );

      res.status(204).send();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to remove credentials');
      res.status(500).json({ error: 'Failed to remove credentials' });
    }
  });

  /**
   * GET /api/tokens/:tokenId/mcps
   * List all MCP credentials for a token
   */
  router.get('/:tokenId/mcps', async (req: Request, res: Response) => {
    try {
      const token = await tokenRepo.findById(req.params.tokenId);
      if (!token || !tokenRepo.isValid(token)) {
        res.status(404).json({ error: 'Token not found or invalid' });
        return;
      }

      const credentials = await mcpCredRepo.listByToken(req.params.tokenId);

      res.json(
        credentials.map((cred) => ({
          credential_id: cred.id,
          mcp_namespace: cred.mcp.namespace,
          mcp_url: cred.mcp.url,
          created_at: cred.createdAt,
          updated_at: cred.updatedAt,
        }))
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list credentials');
      res.status(500).json({ error: 'Failed to list credentials' });
    }
  });

  return router;
}
