import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubscriptionRepository } from "../../src/shared/infra/repository/SubscriptionRepository.js";
import type { MCPAuthConfig } from "../../src/shared/domain/entities.js";

function makePrisma() {
  return {
    subscription: {
      create: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  } as any;
}

const SAMPLE_CREDS: Record<string, MCPAuthConfig> = {
  github: { method: "bearer", token: "ghp_test123" },
  jira: { method: "api_key", key: "jira-key", header: "X-Api-Token" },
};

describe("SubscriptionRepository", () => {
  describe("encryptCredentials / decryptCredentials (roundtrip)", () => {
    it("roundtrips a credential map through encrypt and decrypt", () => {
      const repo = new SubscriptionRepository(makePrisma());
      const encrypted = repo.encryptCredentials(SAMPLE_CREDS);
      expect(typeof encrypted).toBe("string");
      expect(encrypted).not.toContain("ghp_test123");

      const decrypted = repo.decryptCredentials(encrypted);
      expect(decrypted).toEqual(SAMPLE_CREDS);
    });

    it("each call to encryptCredentials produces a different ciphertext (random IV)", () => {
      const repo = new SubscriptionRepository(makePrisma());
      const a = repo.encryptCredentials(SAMPLE_CREDS);
      const b = repo.encryptCredentials(SAMPLE_CREDS);
      expect(a).not.toBe(b);
    });

    it("decryptCredentials returns empty object for invalid ciphertext", () => {
      const repo = new SubscriptionRepository(makePrisma());
      const result = repo.decryptCredentials("not:valid:data");
      expect(result).toEqual({});
    });

    it("decryptCredentials validates each auth config entry against MCPAuthConfigSchema", () => {
      const repo = new SubscriptionRepository(makePrisma());
      const encrypted = repo.encryptCredentials({ github: { method: "bearer", token: "t" } });
      const decrypted = repo.decryptCredentials(encrypted);
      expect(decrypted["github"]).toMatchObject({ method: "bearer", token: "t" });
    });

    it("decryptCredentials returns empty object when an entry fails schema validation", () => {
      const repo = new SubscriptionRepository(makePrisma());
      const encrypted = repo.encryptCredentials({ github: { method: "unknown_method" } } as any);
      const result = repo.decryptCredentials(encrypted);
      expect(result).toEqual({});
    });

    it("decryptCredentials returns empty object for tampered ciphertext", () => {
      const repo = new SubscriptionRepository(makePrisma());
      const result = repo.decryptCredentials(
        "aabbccddeeff00112233445566778899:aabbccddeeff00112233445566778899:aabbccdd"
      );
      expect(result).toEqual({});
    });
  });

  describe("create", () => {
    it("encrypts credentials and calls prisma.create", async () => {
      const prisma = makePrisma();
      prisma.subscription.create.mockResolvedValue({ id: "s1" } as any);
      const repo = new SubscriptionRepository(prisma);

      await repo.create({ name: "sub", bundleId: "b1", createdById: "u1", credentials: SAMPLE_CREDS });

      const arg = prisma.subscription.create.mock.calls[0][0].data;
      expect(typeof arg.credentials).toBe("string");
      expect(arg.credentials).not.toContain("ghp_test123");
    });

    it("stores null credentials when not provided", async () => {
      const prisma = makePrisma();
      prisma.subscription.create.mockResolvedValue({} as any);
      const repo = new SubscriptionRepository(prisma);

      await repo.create({ name: "sub", bundleId: "b1", createdById: "u1" });
      expect(prisma.subscription.create.mock.calls[0][0].data.credentials).toBeNull();
    });

    it("forwards the router value", async () => {
      const prisma = makePrisma();
      prisma.subscription.create.mockResolvedValue({} as any);
      const repo = new SubscriptionRepository(prisma);

      await repo.create({ name: "sub", bundleId: "b1", createdById: "u1", router: "allpass" });
      expect(prisma.subscription.create.mock.calls[0][0].data.router).toBe("allpass");
    });
  });

  describe("findById", () => {
    it("calls findUnique with the id", async () => {
      const prisma = makePrisma();
      prisma.subscription.findUnique.mockResolvedValue(null);
      const repo = new SubscriptionRepository(prisma);

      await repo.findById("sub-42");
      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { id: "sub-42" } });
    });

    it("returns null when not found", async () => {
      const prisma = makePrisma();
      prisma.subscription.findUnique.mockResolvedValue(null);
      expect(await new SubscriptionRepository(prisma).findById("missing")).toBeNull();
    });
  });

  describe("upsertByName", () => {
    it("calls prisma.subscription.upsert with encrypted credentials", async () => {
      const prisma = makePrisma();
      prisma.subscription.upsert.mockResolvedValue({
        id: "sub-1",
        name: "my-sub",
        bundleId: "bundle-1",
        createdById: "user-1",
        credentials: "encrypted",
        router: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const repo = new SubscriptionRepository(prisma);
      await repo.upsertByName("my-sub", "user-1", {
        bundleId: "bundle-1",
        credentials: SAMPLE_CREDS,
        router: null,
      });

      expect(prisma.subscription.upsert).toHaveBeenCalledOnce();
      const call = prisma.subscription.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ name_createdById: { name: "my-sub", createdById: "user-1" } });
      expect(typeof call.create.credentials).toBe("string");
      expect(call.create.credentials).not.toContain("ghp_test123");
    });

    it("passes null credentials when none provided", async () => {
      const prisma = makePrisma();
      prisma.subscription.upsert.mockResolvedValue({
        id: "sub-2",
        name: "no-cred-sub",
        bundleId: "bundle-2",
        createdById: "user-2",
        credentials: null,
        router: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const repo = new SubscriptionRepository(prisma);
      await repo.upsertByName("no-cred-sub", "user-2", { bundleId: "bundle-2" });

      const call = prisma.subscription.upsert.mock.calls[0][0];
      expect(call.create.credentials).toBeNull();
    });
  });

  describe("listByCreator", () => {
    it("calls findMany filtered by createdById ordered by createdAt desc", async () => {
      const prisma = makePrisma();
      prisma.subscription.findMany.mockResolvedValue([]);
      await new SubscriptionRepository(prisma).listByCreator("user-99");
      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: { createdById: "user-99" },
        orderBy: { createdAt: "desc" },
      });
    });

    it("returns all subscriptions for the creator", async () => {
      const prisma = makePrisma();
      prisma.subscription.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
      const result = await new SubscriptionRepository(prisma).listByCreator("u");
      expect(result).toHaveLength(2);
    });
  });

  describe("delete", () => {
    it("calls prisma.delete with the id", async () => {
      const prisma = makePrisma();
      prisma.subscription.delete.mockResolvedValue({} as any);
      await new SubscriptionRepository(prisma).delete("sub-del");
      expect(prisma.subscription.delete).toHaveBeenCalledWith({ where: { id: "sub-del" } });
    });
  });

  describe("findByName", () => {
    it("calls findUnique with the composite unique key", async () => {
      const prisma = makePrisma();
      prisma.subscription.findUnique.mockResolvedValue(null);
      const repo = new SubscriptionRepository(prisma);

      await repo.findByName("my-sub", "user-1");
      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { name_createdById: { name: "my-sub", createdById: "user-1" } },
      });
    });
  });
});
