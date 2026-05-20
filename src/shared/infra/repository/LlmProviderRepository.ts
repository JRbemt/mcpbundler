import { PrismaClient, LlmProvider } from "../../domain/entities.js";
import { LLMProviderConfig } from "../../../bundler/core/schemas.js";
import { encrypt, decrypt } from "../../utils/encryption.js";
import logger from "../../utils/logger.js";

export class LlmProviderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByName(name: string): Promise<LlmProvider | null> {
    return this.prisma.llmProvider.findUnique({ where: { name } });
  }

  async listAll(): Promise<LlmProvider[]> {
    return this.prisma.llmProvider.findMany({ orderBy: { name: "asc" } });
  }

  async seed(providers: Array<{
    name: string;
    model: string;
    endpoint: string;
    description?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  }>): Promise<void> {
    for (const p of providers) {
      await this.prisma.llmProvider.upsert({
        where: { name: p.name },
        create: { ...p },
        update: { model: p.model, endpoint: p.endpoint, description: p.description },
      });
    }
  }

  async upsertUserCredential(userId: string, providerId: string, apiKey: string): Promise<void> {
    const encrypted = encrypt(apiKey);
    await this.prisma.userLlmCredential.upsert({
      where: { userId_providerId: { userId, providerId } },
      create: { userId, providerId, apiKey: encrypted },
      update: { apiKey: encrypted },
    });
  }

  async deleteUserCredential(userId: string, providerId: string): Promise<void> {
    await this.prisma.userLlmCredential.deleteMany({ where: { userId, providerId } });
  }

  async resolveForUser(providerName: string, userId: string): Promise<LLMProviderConfig | null> {
    const provider = await this.findByName(providerName);
    if (!provider) {
      logger.warn({ providerName }, "LLM provider not found");
      return null;
    }

    const cred = await this.prisma.userLlmCredential.findUnique({
      where: { userId_providerId: { userId, providerId: provider.id } },
    });

    let apiKey: string | undefined;
    if (cred) {
      try {
        apiKey = decrypt(cred.apiKey);
      } catch {
        logger.error({ userId, providerId: provider.id }, "Failed to decrypt LLM credential");
      }
    }

    return {
      name: provider.name,
      type: "openai-compatible",
      model: provider.model,
      endpoint: provider.endpoint,
      api_key: apiKey,
      temperature: provider.temperature,
      max_tokens: provider.maxTokens,
      timeout_ms: provider.timeoutMs,
    };
  }
}
