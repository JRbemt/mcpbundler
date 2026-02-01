/**
 * Prisma Session Repository (Adapter)
 *
 * Implements ISessionRepository using Prisma ORM.
 * Handles persistence, reconstitution of Session aggregates, and transactions.
 */

import { PrismaClient } from "@prisma/client";
import { Repository } from "../../domain/Repository.js";
import { Session } from "../../domain/entities.js";

export class SessionRepository implements Repository<Session, "id"> {
  constructor(private readonly prisma: PrismaClient) { }

  public async create(item: Session): Promise<{ record: Session }> {

    const record = await this.prisma.session.create({
      data: item,
    });

    return { record }
  }

  async update(item: Partial<Session> & { id: string }): Promise<Session> {
    const { id, ...data } = item;

    return await this.prisma.session.update({
      where: { id },
      data
    });
  }

  async findFirst(field: keyof Omit<Session, "id" | "createdAt">, value: unknown): Promise<Session | null> {
    return await this.prisma.session.findFirst({
      where: { [field]: value } as any
    });
  }

  public async findById(id: string): Promise<Session | null> {
    return await this.prisma.session.findUnique({
      where: { id }
    });
  }

  public async findAllActive(): Promise<Session[]> {
    return await this.prisma.session.findMany({
      where: {} // All sessions are active (terminated ones are deleted)
    });
  }

  public async findIdle(idleTimeoutMs: number): Promise<Session[]> {
    const threshold = new Date(Date.now() - idleTimeoutMs);

    return await this.prisma.session.findMany({
      where: {
        createdAt: {
          lt: threshold
        }
      }
    });
  }

  public async delete(id: string): Promise<void> {
    await this.prisma.session.delete({
      where: { id }
    });

  }

  public async exists(id: string): Promise<boolean> {
    return this.findById(id) !== null
  }
}
