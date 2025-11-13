import express, { Request, Response, Router } from 'express';
import { PrismaClient } from '@prisma/client';
import logger from '../../utils/logger.js';
import {
  CollectionRepository,
  McpRepository,
} from '../database/repositories/index.js';
import { UpstreamConfigSchema } from '../../config/schemas.js';
import { z } from 'zod';

export function createCollectionRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const collectionRepo = new CollectionRepository(prisma);
  const mcpRepo = new McpRepository(prisma);

  /**
   * GET /api/collections
   * List all collections
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const collections = await collectionRepo.list();

      const response = collections.map((collection) => ({
        id: collection.id,
        name: collection.name,
        created_at: collection.createdAt,
        mcps: collection.collectionMcps.map((collectionMcp) => ({
          namespace: collectionMcp.mcp.namespace,
          url: collectionMcp.mcp.url,
          author: collectionMcp.mcp.author,
          description: collectionMcp.mcp.description,
          version: collectionMcp.mcp.version,
          stateless: collectionMcp.mcp.stateless,
        })),
      }));

      res.json(response);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list collections');
      res.status(500).json({ error: 'Failed to list collections' });
    }
  });

  /**
   * GET /api/collections/:id
   * Get a specific collection
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const collection = await collectionRepo.findById(req.params.id);

      if (!collection) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }

      res.json({
        id: collection.id,
        name: collection.name,
        created_at: collection.createdAt,
        mcps: collection.collectionMcps.map((collectionMcp) => ({
          namespace: collectionMcp.mcp.namespace,
          url: collectionMcp.mcp.url,
          author: collectionMcp.mcp.author,
          description: collectionMcp.mcp.description,
          version: collectionMcp.mcp.version,
          stateless: collectionMcp.mcp.stateless,
          token_cost: collectionMcp.mcp.tokenCost,
          permissions: {
            allowed_tools: JSON.parse(collectionMcp.allowedTools),
            allowed_resources: JSON.parse(collectionMcp.allowedResources),
            allowed_prompts: JSON.parse(collectionMcp.allowedPrompts),
          },
        })),
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get collection');
      res.status(500).json({ error: 'Failed to get collection' });
    }
  });

  /**
   * POST /api/collections
   * Create a new collection
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { name } = req.body;

      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Collection name is required' });
        return;
      }

      const collection = await collectionRepo.create(name);

      logger.info({ collectionId: collection.id, name }, 'Created new collection');

      res.status(201).json({
        id: collection.id,
        name: collection.name,
        created_at: collection.createdAt,
      });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create collection');
      res.status(500).json({ error: 'Failed to create collection' });
    }
  });

  /**
   * DELETE /api/collections/:id
   * Delete a collection
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const collection = await collectionRepo.findById(req.params.id);

      if (!collection) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }

      await collectionRepo.delete(req.params.id);

      logger.info({ collectionId: req.params.id }, 'Deleted collection');

      res.status(204).send();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to delete collection');
      res.status(500).json({ error: 'Failed to delete collection' });
    }
  });

  /**
   * GET /api/collections/:id/mcps
   * List MCPs in a collection
   */
  router.get('/:id/mcps', async (req: Request, res: Response) => {
    try {
      const collectionMcps = await collectionRepo.listMcps(req.params.id);

      res.json(
        collectionMcps.map((collectionMcp) => ({
          namespace: collectionMcp.mcp.namespace,
          url: collectionMcp.mcp.url,
          author: collectionMcp.mcp.author,
          description: collectionMcp.mcp.description,
          version: collectionMcp.mcp.version,
          stateless: collectionMcp.mcp.stateless,
          auth_strategy: collectionMcp.authStrategy,
          token_cost: collectionMcp.mcp.tokenCost,
          permissions: {
            allowed_tools: JSON.parse(collectionMcp.allowedTools),
            allowed_resources: JSON.parse(collectionMcp.allowedResources),
            allowed_prompts: JSON.parse(collectionMcp.allowedPrompts),
          },
        }))
      );
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to list collection MCPs');
      res.status(500).json({ error: 'Failed to list MCPs' });
    }
  });

  /**
   * POST /api/collections/:id/mcps
   * Add an MCP to a collection
   */
  router.post('/:id/mcps', async (req: Request, res: Response) => {
    try {
      // Validate collection exists
      const collection = await collectionRepo.findById(req.params.id);
      if (!collection) {
        res.status(404).json({ error: 'Collection not found' });
        return;
      }

      // Validate MCP config
      const mcpConfig = UpstreamConfigSchema.parse(req.body);

      // Find or create master MCP
      let mcp = await mcpRepo.findByNamespace(mcpConfig.namespace);
      if (!mcp) {
        mcp = await mcpRepo.create({
          namespace: mcpConfig.namespace,
          url: mcpConfig.url,
          author: mcpConfig.author,
          description: mcpConfig.description,
          version: mcpConfig.version,
          stateless: mcpConfig.stateless,
          tokenCost: mcpConfig.token_cost,
        });
      }

      // Check if MCP already in collection
      const existing = await collectionRepo.findMcpInCollection(
        req.params.id,
        mcp.id
      );

      if (existing) {
        res.status(409).json({ error: 'MCP already exists in this collection' });
        return;
      }

      // Add MCP to collection with auth strategy and permissions
      const collectionMcp = await collectionRepo.addMcp(
        req.params.id,
        mcp.id,
        mcpConfig.auth_strategy,
        mcpConfig.permissions
      );

      logger.info(
        { collectionId: req.params.id, namespace: mcpConfig.namespace, authStrategy: mcpConfig.auth_strategy },
        'Added MCP to collection'
      );

      res.status(201).json({
        namespace: mcp.namespace,
        url: mcp.url,
        author: mcp.author,
        description: mcp.description,
        version: mcp.version,
        stateless: mcp.stateless,
        auth_strategy: collectionMcp.authStrategy,
        token_cost: mcp.tokenCost,
        permissions: {
          allowed_tools: JSON.parse(collectionMcp.allowedTools),
          allowed_resources: JSON.parse(collectionMcp.allowedResources),
          allowed_prompts: JSON.parse(collectionMcp.allowedPrompts),
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: 'Invalid MCP configuration', details: error.errors });
        return;
      }

      logger.error({ error: error.message }, 'Failed to add MCP');
      res.status(500).json({ error: 'Failed to add MCP' });
    }
  });

  /**
   * DELETE /api/collections/:id/mcps/:namespace
   * Remove an MCP from a collection
   */
  router.delete('/:id/mcps/:namespace', async (req: Request, res: Response) => {
    try {
      // Find the master MCP by namespace
      const mcp = await mcpRepo.findByNamespace(req.params.namespace);

      if (!mcp) {
        res.status(404).json({ error: 'MCP not found' });
        return;
      }

      // Check if MCP exists in collection
      const collectionMcp = await collectionRepo.findMcpInCollection(
        req.params.id,
        mcp.id
      );

      if (!collectionMcp) {
        res.status(404).json({ error: 'MCP not found in collection' });
        return;
      }

      // Remove from collection (doesn't delete master)
      await collectionRepo.removeMcp(req.params.id, mcp.id);

      logger.info(
        { collectionId: req.params.id, namespace: req.params.namespace },
        'Removed MCP from collection'
      );

      res.status(204).send();
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to remove MCP');
      res.status(500).json({ error: 'Failed to remove MCP' });
    }
  });

  return router;
}
