import { PrismaClient, Subscription } from "../../domain/entities.js";
import { MCPAuthConfig, MCPAuthConfigSchema } from "../../domain/entities.js";
import { decryptJSON, encryptJSON } from "../../utils/encryption.js";
import logger from "../../utils/logger.js";

export class SubscriptionRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(data: {
    name: string;
    bundleId: string;
    createdById: string;
    credentials?: Record<string, MCPAuthConfig>;
    router?: string | null;
  }): Promise<Subscription> {
    return this.prisma.subscription.create({
      data: {
        name: data.name,
        bundleId: data.bundleId,
        createdById: data.createdById,
        credentials: data.credentials ? this.encryptCredentials(data.credentials) : null,
        router: data.router ?? null,
      },
    });
  }

  async findById(id: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({ where: { id } });
  }

  async findByName(name: string, createdById: string): Promise<Subscription | null> {
    return this.prisma.subscription.findUnique({
      where: { name_createdById: { name, createdById } },
    });
  }

  async upsertByName(
    name: string,
    createdById: string,
    data: {
      bundleId: string;
      credentials?: Record<string, MCPAuthConfig>;
      router?: string | null;
    }
  ): Promise<Subscription> {
    const credentials = data.credentials ? this.encryptCredentials(data.credentials) : null;
    return this.prisma.subscription.upsert({
      where: { name_createdById: { name, createdById } },
      create: {
        name,
        createdById,
        bundleId: data.bundleId,
        credentials,
        router: data.router ?? null,
      },
      update: {
        bundleId: data.bundleId,
        credentials,
        router: data.router ?? null,
      },
    });
  }

  async listByCreator(createdById: string): Promise<Subscription[]> {
    return this.prisma.subscription.findMany({
      where: { createdById },
      orderBy: { createdAt: "desc" },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.subscription.delete({ where: { id } });
  }

  encryptCredentials(creds: Record<string, MCPAuthConfig>): string {
    return encryptJSON(creds);
  }

  decryptCredentials(raw: string): Record<string, MCPAuthConfig> {
    try {
      const decrypted = decryptJSON<Record<string, unknown>>(raw);
      const result: Record<string, MCPAuthConfig> = {};
      for (const [ns, auth] of Object.entries(decrypted)) {
        result[ns] = MCPAuthConfigSchema.parse(auth);
      }
      return result;
    } catch {
      logger.error("Failed to decrypt subscription credentials");
      return {};
    }
  }
}
