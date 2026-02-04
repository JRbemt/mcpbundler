import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CacheManager } from "../../../src/shared/utils/cacheable.js";

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
});
