/**
 * Subscription Routes - Named subscription management
 *
 * A subscription is a named, persistent link from a user to a bundle that holds
 * per-namespace credentials for USER_SET MCPs. Access tokens generated for a
 * subscription inherit its credentials; only one credential store needs to be
 * updated when keys rotate.
 *
 * Endpoints:
 * - POST   /api/subscriptions               - Upsert subscription by name
 * - GET    /api/subscriptions               - List subscriptions for authenticated user
 * - GET    /api/subscriptions/:name         - Get single subscription
 * - DELETE /api/subscriptions/:name         - Remove subscription and its tokens
 * - POST   /api/subscriptions/:name/token   - Generate access token for subscription
 */

import express, { Request, Router } from "express";
import { z } from "zod";
import { PrismaClient } from "../../shared/domain/entities.js";
import { BundleRepository, BundleTokenRepository, SubscriptionRepository } from "../../shared/infra/repository/index.js";
import {
  validatedBodyHandler,
  validatedHandler,
  sendNotFound,
} from "./utils/route-utils.js";
import { MCPAuthConfigSchema } from "../../shared/domain/entities.js";
import { BundleRouterConfigSchema } from "../../bundler/core/schemas.js";
import { AuditApiAction } from "../../shared/utils/audit-log.js";
import logger from "../../shared/utils/logger.js";

// Request schemas
const UpsertSubscriptionRequestSchema = z.object({
  name: z.string().min(1, "Subscription name is required"),
  bundleId: z.string().uuid("bundleId must be a UUID"),
  credentials: z.record(z.string(), MCPAuthConfigSchema).optional(),
  router: BundleRouterConfigSchema.optional(),
});

const GenerateSubscriptionTokenRequestSchema = z.object({
  name: z.string().min(1, "Token name is required"),
  description: z.string().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

// Response schemas
const SubscriptionResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  bundleId: z.string(),
  createdById: z.string(),
  hasCredentials: z.boolean(),
  hasRouter: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const GenerateSubscriptionTokenResponseSchema = z.object({
  token: z.string(),
  tokenId: z.string(),
  tokenName: z.string(),
  subscriptionId: z.string(),
  bundleId: z.string(),
});

export type SubscriptionResponse = z.infer<typeof SubscriptionResponseSchema>;
export type GenerateSubscriptionTokenResponse = z.infer<typeof GenerateSubscriptionTokenResponseSchema>;
export type UpsertSubscriptionRequest = z.infer<typeof UpsertSubscriptionRequestSchema>;
export type GenerateSubscriptionTokenRequest = z.infer<typeof GenerateSubscriptionTokenRequestSchema>;

function toSubscriptionResponse(sub: {
  id: string;
  name: string;
  bundleId: string;
  createdById: string;
  credentials: string | null;
  router: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SubscriptionResponse {
  return {
    id: sub.id,
    name: sub.name,
    bundleId: sub.bundleId,
    createdById: sub.createdById,
    hasCredentials: sub.credentials !== null,
    hasRouter: sub.router !== null,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
  };
}

export function createSubscriptionRoutes(prisma: PrismaClient): Router {
  const router = express.Router();
  const subscriptionRepo = new SubscriptionRepository(prisma);
  const bundleRepo = new BundleRepository(prisma);
  const tokenRepo = new BundleTokenRepository(prisma);

  /**
   * POST /api/subscriptions
   * Upsert subscription by name (create or update credentials/router for existing name)
   */
  router.post(
    "/",
    ...validatedBodyHandler(
      UpsertSubscriptionRequestSchema,
      SubscriptionResponseSchema,
      async (req, _res, data) => {
        const createdById = req.apiAuth!.userId;

        const bundle = await bundleRepo.findById(data.bundleId);
        if (!bundle) {
          const err: any = new Error(`Bundle ${data.bundleId} not found`);
          err.status = 404;
          throw err;
        }

        const routerJson = data.router ? JSON.stringify(data.router) : null;
        const sub = await subscriptionRepo.upsertByName(data.name, createdById, {
          bundleId: data.bundleId,
          credentials: data.credentials,
          router: routerJson,
        });

        logger.info({ subscriptionId: sub.id, name: sub.name }, "Upserted subscription");
        return toSubscriptionResponse(sub);
      },
      {
        action: AuditApiAction.SUBSCRIPTION_CREATE,
        successStatus: 201,
        errorMessage: "Failed to upsert subscription",
        getAuditDetails: (_req, result) => ({ subscriptionId: result?.id }),
      }
    )
  );

  /**
   * GET /api/subscriptions
   * List subscriptions created by the authenticated user
   */
  router.get(
    "/",
    validatedHandler(
      SubscriptionResponseSchema.array(),
      async (req) => {
        const subs = await subscriptionRepo.listByCreator(req.apiAuth!.userId);
        return subs.map(toSubscriptionResponse);
      },
      {
        action: AuditApiAction.SUBSCRIPTION_VIEW,
        errorMessage: "Failed to list subscriptions",
        getAuditDetails: (_req, result) => ({ count: result?.length }),
      }
    )
  );

  /**
   * GET /api/subscriptions/:name
   * Get a single subscription by name (must be owned by the caller)
   */
  router.get(
    "/:name",
    validatedHandler(
      SubscriptionResponseSchema,
      async (req: Request<{ name: string }>, res) => {
        const sub = await subscriptionRepo.findByName(req.params.name, req.apiAuth!.userId);
        if (!sub) {
          return sendNotFound(res, "Subscription", req, AuditApiAction.SUBSCRIPTION_VIEW, {
            name: req.params.name,
          });
        }
        return toSubscriptionResponse(sub);
      },
      {
        action: AuditApiAction.SUBSCRIPTION_VIEW,
        errorMessage: "Failed to get subscription",
        getAuditDetails: (req, result) => ({ name: req.params.name, subscriptionId: result?.id }),
      }
    )
  );

  /**
   * DELETE /api/subscriptions/:name
   * Remove subscription (and cascade to its tokens via DB constraint)
   */
  router.delete(
    "/:name",
    validatedHandler(
      null,
      async (req: Request<{ name: string }>, res) => {
        const sub = await subscriptionRepo.findByName(req.params.name, req.apiAuth!.userId);
        if (!sub) {
          return sendNotFound(res, "Subscription", req, AuditApiAction.SUBSCRIPTION_DELETE, {
            name: req.params.name,
          });
        }

        await subscriptionRepo.delete(sub.id);
        logger.info({ subscriptionId: sub.id, name: sub.name }, "Deleted subscription");
      },
      {
        action: AuditApiAction.SUBSCRIPTION_DELETE,
        successStatus: 204,
        errorMessage: "Failed to delete subscription",
        getAuditDetails: (req) => ({ name: req.params.name }),
      }
    )
  );

  /**
   * POST /api/subscriptions/:name/token
   * Generate an access token bound to this subscription
   * The token inherits credentials and router config from the subscription.
   */
  router.post(
    "/:name/token",
    ...validatedBodyHandler(
      GenerateSubscriptionTokenRequestSchema,
      GenerateSubscriptionTokenResponseSchema,
      async (req: Request<{ name: string }>, res, data) => {
        const sub = await subscriptionRepo.findByName(req.params.name, req.apiAuth!.userId);
        if (!sub) {
          return sendNotFound(res, "Subscription", req, AuditApiAction.SUBSCRIPTION_TOKEN, {
            name: req.params.name,
          });
        }

        const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
        const { record, token } = await tokenRepo.create({
          bundleId: sub.bundleId,
          subscriptionId: sub.id,
          name: data.name,
          description: data.description ?? null,
          createdById: req.apiAuth!.userId,
          expiresAt,
          revoked: false,
          lastUsedAt: null,
        });

        logger.info(
          { tokenId: record.id, subscriptionId: sub.id, subscriptionName: sub.name },
          "Generated subscription token"
        );

        return {
          token,
          tokenId: record.id,
          tokenName: record.name,
          subscriptionId: sub.id,
          bundleId: sub.bundleId,
        };
      },
      {
        action: AuditApiAction.SUBSCRIPTION_TOKEN,
        successStatus: 201,
        errorMessage: "Failed to generate subscription token",
        getAuditDetails: (_req, result) => ({
          tokenId: result?.tokenId,
          subscriptionId: result?.subscriptionId,
        }),
      }
    )
  );

  return router;
}
