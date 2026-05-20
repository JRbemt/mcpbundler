import { PrismaClient } from "../domain/entities.js";
import { PrismaPg } from "@prisma/adapter-pg";
import logger from "./logger.js";

let prismaInstance: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    const adapter = new PrismaPg({ connectionString });
    prismaInstance = new PrismaClient({ adapter } as any);
    logger.info("Prisma client initialized");
  }

  return prismaInstance;
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
    logger.info("Prisma client disconnected");
  }
}
