import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CacheManager, cached } from "../../../src/shared/utils/cacheable.js";

describe("CacheManager", () => {
  let cache: CacheManager<{ value: string }>;

  beforeEach(() => {
    cache = new CacheManager<{ value: string }>({
      max: 5,
      ttl: 10000,
    });
  });

  describe("get / set", () => {
    it("should store and retrieve values", () => {
      cache.set("key1", { value: "hello" });
      expect(cache.get("key1")).toEqual({ value: "hello" });
    });

    it("should return undefined for missing keys", () => {
      expect(cache.get("nonexistent")).toBeUndefined();
    });

    it("should overwrite existing values", () => {
      cache.set("key1", { value: "first" });
      cache.set("key1", { value: "second" });
      expect(cache.get("key1")).toEqual({ value: "second" });
    });
  });

  describe("has", () => {
    it("should return true for existing keys", () => {
      cache.set("key1", { value: "test" });
      expect(cache.has("key1")).toBe(true);
    });

    it("should return false for missing keys", () => {
      expect(cache.has("nonexistent")).toBe(false);
    });
  });

  describe("invalidate", () => {
    it("should remove a specific key", () => {
      cache.set("key1", { value: "test1" });
      cache.set("key2", { value: "test2" });

      cache.invalidate("key1");

      expect(cache.has("key1")).toBe(false);
      expect(cache.has("key2")).toBe(true);
    });

    it("should clear all entries when called without key", () => {
      cache.set("key1", { value: "test1" });
      cache.set("key2", { value: "test2" });
      cache.set("key3", { value: "test3" });

      cache.invalidate();

      expect(cache.size()).toBe(0);
    });

    it("should not throw when invalidating nonexistent key", () => {
      expect(() => cache.invalidate("nonexistent")).not.toThrow();
    });
  });

  describe("size", () => {
    it("should return 0 for empty cache", () => {
      expect(cache.size()).toBe(0);
    });

    it("should return correct count after insertions", () => {
      cache.set("key1", { value: "a" });
      cache.set("key2", { value: "b" });
      expect(cache.size()).toBe(2);
    });

    it("should not double-count overwrites", () => {
      cache.set("key1", { value: "first" });
      cache.set("key1", { value: "second" });
      expect(cache.size()).toBe(1);
    });
  });

  describe("keys", () => {
    it("should return empty array for empty cache", () => {
      expect(cache.keys()).toEqual([]);
    });

    it("should return all stored keys", () => {
      cache.set("alpha", { value: "a" });
      cache.set("beta", { value: "b" });

      const keys = cache.keys();
      expect(keys).toContain("alpha");
      expect(keys).toContain("beta");
      expect(keys).toHaveLength(2);
    });
  });

  describe("TTL expiration", () => {
    it("should expire entries after TTL", async () => {
      // lru-cache uses performance.now() internally, so real timers are needed
      const shortTTLCache = new CacheManager<{ value: string }>({
        max: 10,
        ttl: 50,
      });

      shortTTLCache.set("key1", { value: "test" });
      expect(shortTTLCache.has("key1")).toBe(true);

      await new Promise((r) => setTimeout(r, 150));

      expect(shortTTLCache.get("key1")).toBeUndefined();
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest entries when max is exceeded", () => {
      // Cache with max 3 entries; disable size-based eviction by using a large maxSize
      const smallCache = new CacheManager<{ value: string }>({
        max: 3,
        maxSize: 100 * 1024 * 1024,
        ttl: 60000,
      });

      smallCache.set("a", { value: "1" });
      smallCache.set("b", { value: "2" });
      smallCache.set("c", { value: "3" });
      smallCache.set("d", { value: "4" });

      expect(smallCache.size()).toBe(3);
      expect(smallCache.has("a")).toBe(false);
      expect(smallCache.has("d")).toBe(true);
    });
  });

  describe("custom TTL per entry", () => {
    it("should accept per-entry TTL override", async () => {
      // Use real timers with a short wait; lru-cache TTL does not work with fake timers
      const fastCache = new CacheManager<{ value: string }>({
        max: 10,
        ttl: 60000,
      });

      fastCache.set("short", { value: "expires-soon" }, 50);
      fastCache.set("long", { value: "stays" }, 60000);

      await new Promise((r) => setTimeout(r, 150));

      expect(fastCache.get("short")).toBeUndefined();
      expect(fastCache.get("long")).toEqual({ value: "stays" });
    });
  });

  describe("sizeCalculation fallback", () => {
    it("falls back to 1024 for non-serialisable (circular) values", () => {
      const c = new CacheManager<any>();
      const circular: any = {};
      circular.self = circular;
      c.set("circular", circular);
      expect(c.has("circular")).toBe(true);
    });
  });
});

describe("@cached decorator", () => {
  it("returns cached value on second call without re-executing the method", async () => {
    const compute = vi.fn(async (n: number) => n * 2);

    class Svc {
      cache = new CacheManager<number>();

      @cached<Svc, number, [number]>((self) => self.cache, (n) => String(n))
      async double(n: number): Promise<number> { return compute(n); }
    }

    const svc = new Svc();
    expect(await svc.double(5)).toBe(10);
    expect(await svc.double(5)).toBe(10);
    expect(compute).toHaveBeenCalledOnce();
  });

  it("calls through again for a different argument", async () => {
    const compute = vi.fn(async (n: number) => n * 3);

    class Svc {
      cache = new CacheManager<number>();

      @cached<Svc, number, [number]>((self) => self.cache, (n) => String(n))
      async triple(n: number): Promise<number> { return compute(n); }
    }

    const svc = new Svc();
    await svc.triple(2);
    await svc.triple(3);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("skips cache when shouldCache returns false", async () => {
    const compute = vi.fn(async (n: number) => n);

    class Svc {
      cache = new CacheManager<number>();

      @cached<Svc, number, [number]>((self) => self.cache, (n) => String(n), () => false)
      async pass(n: number): Promise<number> { return compute(n); }
    }

    const svc = new Svc();
    await svc.pass(1);
    await svc.pass(1);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("uses JSON.stringify as the default key function when no keyFn is provided", async () => {
    const compute = vi.fn(async (a: string, b: number) => `${a}-${b}`);

    class Svc {
      cache = new CacheManager<string>();

      @cached<Svc, string, [string, number]>((self) => self.cache)
      async combine(a: string, b: number): Promise<string> { return compute(a, b); }
    }

    const svc = new Svc();
    expect(await svc.combine("x", 1)).toBe("x-1");
    expect(await svc.combine("x", 1)).toBe("x-1");
    expect(compute).toHaveBeenCalledOnce();

    expect(await svc.combine("x", 2)).toBe("x-2");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("cache is per-instance not shared across instances", async () => {
    const compute = vi.fn(async (n: number) => n);

    class Svc {
      cache = new CacheManager<number>();

      @cached<Svc, number, [number]>((self) => self.cache, (n) => String(n))
      async id(n: number): Promise<number> { return compute(n); }
    }

    await new Svc().id(7);
    await new Svc().id(7);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
