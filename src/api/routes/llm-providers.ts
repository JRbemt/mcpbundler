/**
 * LLM Provider Routes - Registry LLM provider listing and user credential binding
 *
 * Endpoints:
 * - GET    /api/llm-providers            - List all available LLM providers
 * - PUT    /api/llm-bindings/:provider   - Upsert caller's API key for a provider
 * - DELETE /api/llm-bindings/:provider   - Remove caller's API key binding
 */

import { Router, Request } from "express";
import { z } from "zod";
import { PrismaClient } from "../../shared/domain/entities.js";
import { LlmProviderRepository } from "../../shared/infra/repository/index.js";
import {
  validatedBodyHandler,
  validatedHandler,
  sendNotFound,
} from "./utils/route-utils.js";
import { AuditApiAction } from "../../shared/utils/audit-log.js";
import logger from "../../shared/utils/logger.js";

const LlmProviderResponseSchema = z.object({
  name: z.string(),
  model: z.string(),
  endpoint: z.string(),
  description: z.string().nullable(),
});

const LlmBindingResponseSchema = z.object({
  provider: z.string(),
  bound: z.boolean(),
});

const UpsertLlmBindingSchema = z.object({
  apiKey: z.string().min(1, "apiKey is required"),
});

export type LlmProviderResponse = z.infer<typeof LlmProviderResponseSchema>;
export type LlmBindingResponse = z.infer<typeof LlmBindingResponseSchema>;

export function createLlmProviderRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const repo = new LlmProviderRepository(prisma);

  router.get(
    "/llm-providers",
    validatedHandler(
      LlmProviderResponseSchema.array(),
      async (_req) => {
        const providers = await repo.listAll();
        return providers.map((p) => ({
          name: p.name,
          model: p.model,
          endpoint: p.endpoint,
          description: p.description ?? null,
        }));
      },
      {
        action: AuditApiAction.LLM_PROVIDER_VIEW,
        errorMessage: "Failed to list LLM providers",
      }
    )
  );

  router.put(
    "/llm-bindings/:provider",
    ...validatedBodyHandler(
      UpsertLlmBindingSchema,
      LlmBindingResponseSchema,
      async (req: Request<{ provider: string }>, res, data) => {
        const providerName = req.params.provider;
        const userId = req.apiAuth!.userId;

        const provider = await repo.findByName(providerName);
        if (!provider) {
          return sendNotFound(res, "LLM Provider", req, AuditApiAction.LLM_CREDENTIAL_BIND, {
            provider: providerName,
          });
        }

        await repo.upsertUserCredential(userId, provider.id, data.apiKey);
        logger.info({ userId, providerName }, "LLM credential bound");
        return { provider: providerName, bound: true };
      },
      {
        action: AuditApiAction.LLM_CREDENTIAL_BIND,
        errorMessage: "Failed to bind LLM credential",
        getAuditDetails: (req) => ({ provider: req.params.provider }),
      }
    )
  );

  router.delete(
    "/llm-bindings/:provider",
    validatedHandler(
      LlmBindingResponseSchema,
      async (req: Request<{ provider: string }>, res) => {
        const providerName = req.params.provider;
        const userId = req.apiAuth!.userId;

        const provider = await repo.findByName(providerName);
        if (!provider) {
          return sendNotFound(res, "LLM Provider", req, AuditApiAction.LLM_CREDENTIAL_REMOVE, {
            provider: providerName,
          });
        }

        await repo.deleteUserCredential(userId, provider.id);
        logger.info({ userId, providerName }, "LLM credential removed");
        return { provider: providerName, bound: false };
      },
      {
        action: AuditApiAction.LLM_CREDENTIAL_REMOVE,
        errorMessage: "Failed to remove LLM credential",
        getAuditDetails: (req) => ({ provider: req.params.provider }),
      }
    )
  );

  return router;
}
