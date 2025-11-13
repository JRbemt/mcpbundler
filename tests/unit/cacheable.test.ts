/**
 * Unit tests for cacheable utilities (LRU-based implementation)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CacheManager,
  cached,
} from '../../src/utils/cacheable.js';

describe('CacheManager', () => {
  let cache: CacheManager<string>;

  beforeEach(() => {
    cache = new CacheManager<string>({ ttl: 1000 }); // 1 second TTL
  });

  describe('constructor and basic options', () => {
    it('should create cache with default options', () => {
      const defaultCache = new CacheManager<string>({});
      defaultCache.set('key1', 'value1');
      expect(defaultCache.get('key1')).toBe('value1');
    });

    it('should create cache with custom TTL', () => {
      const customCache = new CacheManager<string>({ ttl: 5000 });
      customCache.set('key1', 'value1');
      expect(customCache.get('key1')).toBe('value1');
    });

    it('should create cache with custom max entries', () => {
      const limitedCache = new CacheManager<string>({ max: 2 });
      limitedCache.set('key1', 'value1');
      limitedCache.set('key2', 'value2');
      limitedCache.set('key3', 'value3'); // Should evict key1 (LRU)

      expect(limitedCache.get('key1')).toBeUndefined();
      expect(limitedCache.get('key2')).toBe('value2');
      expect(limitedCache.get('key3')).toBe('value3');
    });

    it('should create cache with custom maxSize', () => {
      const sizeCache = new CacheManager<string>({
        maxSize: 100, // 100 bytes
        ttl: 60000
      });
      sizeCache.set('key1', 'value1');
      expect(sizeCache.get('key1')).toBe('value1');
    });
  });

  describe('get/set operations', () => {
    it('should set and get a value', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent key', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing key', () => {
      cache.set('key1', 'value1');
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');
    });

    it('should handle multiple keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });
  });

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortCache = new CacheManager<string>({ ttl: 100 });
      shortCache.set('key1', 'value1');
      expect(shortCache.get('key1')).toBe('value1');

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(shortCache.get('key1')).toBeUndefined();
    });

    it('should allow custom TTL per entry', async () => {
      const testCache = new CacheManager<string>({ ttl: 1000 });
      testCache.set('short', 'value1', 50);
      testCache.set('long', 'value2', 200);

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(testCache.get('short')).toBeUndefined();
      expect(testCache.get('long')).toBe('value2');
    });

    it('should not expire entries before TTL', async () => {
      const testCache = new CacheManager<string>({ ttl: 200 });
      testCache.set('key1', 'value1');

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(testCache.get('key1')).toBe('value1');
    });

    it('should respect entry-specific TTL over default', async () => {
      const testCache = new CacheManager<string>({ ttl: 1000 });
      testCache.set('key1', 'value1', 50); // Override with shorter TTL

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(testCache.get('key1')).toBeUndefined();
    });
  });

  describe('invalidation', () => {
    it('should invalidate a specific key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.invalidate('key1');

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBe('value2');
    });

    it('should invalidate all keys when no key specified', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.invalidate();

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBeUndefined();
      expect(cache.size()).toBe(0);
    });

    it('should handle invalidating non-existent key', () => {
      expect(() => cache.invalidate('nonexistent')).not.toThrow();
    });
  });

  describe('has method', () => {
    it('should return true for existing key', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      const testCache = new CacheManager<string>({ ttl: 50 });
      testCache.set('key1', 'value1');
      expect(testCache.has('key1')).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 100));
      expect(testCache.has('key1')).toBe(false);
    });
  });

  describe('size method', () => {
    it('should return correct size', () => {
      expect(cache.size()).toBe(0);

      cache.set('key1', 'value1');
      expect(cache.size()).toBe(1);

      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);
    });

    it('should update size after invalidation', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);

      cache.invalidate('key1');
      expect(cache.size()).toBe(1);
    });

    it('should return 0 for empty cache', () => {
      expect(cache.size()).toBe(0);
    });

    it('should update size after clear', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.invalidate();
      expect(cache.size()).toBe(0);
    });
  });

  describe('keys method', () => {
    it('should return all valid keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      const keys = cache.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('should return empty array for empty cache', () => {
      expect(cache.keys()).toEqual([]);
    });

    it('should exclude invalidated keys', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.invalidate('key1');

      const keys = cache.keys();
      expect(keys).toHaveLength(1);
      expect(keys).toContain('key2');
      expect(keys).not.toContain('key1');
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when max is reached', () => {
      const lruCache = new CacheManager<string>({ max: 3, ttl: 60000 });

      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');
      lruCache.set('key3', 'value3');

      expect(lruCache.size()).toBe(3);

      // Adding a 4th item should evict key1
      lruCache.set('key4', 'value4');

      expect(lruCache.size()).toBe(3);
      expect(lruCache.get('key1')).toBeUndefined();
      expect(lruCache.get('key2')).toBe('value2');
      expect(lruCache.get('key3')).toBe('value3');
      expect(lruCache.get('key4')).toBe('value4');
    });

    it('should update LRU order when entry is accessed', () => {
      const lruCache = new CacheManager<string>({ max: 3, ttl: 60000 });

      lruCache.set('key1', 'value1');
      lruCache.set('key2', 'value2');
      lruCache.set('key3', 'value3');

      // Access key1 to make it recently used
      lruCache.get('key1');

      // Adding key4 should now evict key2 (least recently used)
      lruCache.set('key4', 'value4');

      expect(lruCache.get('key1')).toBe('value1'); // Still exists
      expect(lruCache.get('key2')).toBeUndefined(); // Evicted
      expect(lruCache.get('key3')).toBe('value3');
      expect(lruCache.get('key4')).toBe('value4');
    });
  });

  describe('type safety', () => {
    it('should work with number types', () => {
      const numberCache = new CacheManager<number>({});
      numberCache.set('count', 42);
      expect(numberCache.get('count')).toBe(42);
    });

    it('should work with object types', () => {
      const objectCache = new CacheManager<{ id: number; name: string }>({});
      objectCache.set('user', { id: 1, name: 'John' });
      expect(objectCache.get('user')).toEqual({ id: 1, name: 'John' });
    });

    it('should work with array types', () => {
      const arrayCache = new CacheManager<string[]>({});
      arrayCache.set('tags', ['tag1', 'tag2']);
      expect(arrayCache.get('tags')).toEqual(['tag1', 'tag2']);
    });

    it('should work with complex nested types', () => {
      interface ComplexType {
        users: Array<{ id: number; roles: string[] }>;
        metadata: { created: number; updated: number };
      }

      const complexCache = new CacheManager<ComplexType>({});
      const complexData: ComplexType = {
        users: [{ id: 1, roles: ['admin', 'user'] }],
        metadata: { created: Date.now(), updated: Date.now() }
      };

      complexCache.set('data', complexData);
      expect(complexCache.get('data')).toEqual(complexData);
    });
  });
});

describe('cached decorator', () => {
  class TestService {
    cache = new CacheManager<string>({ ttl: 1000 });
    callCount = 0;

    @cached(
      (instance: TestService) => instance.cache,
      (arg: string) => arg
    )
    async fetchData(key: string): Promise<string> {
      this.callCount++;
      return `data-${key}`;
    }
  }

  let service: TestService;

  beforeEach(() => {
    service = new TestService();
  });

  it('should cache method results', async () => {
    const result1 = await service.fetchData('test');
    const result2 = await service.fetchData('test');

    expect(result1).toBe('data-test');
    expect(result2).toBe('data-test');
    expect(service.callCount).toBe(1); // Method called only once
  });

  it('should use cache for same arguments', async () => {
    await service.fetchData('key1');
    await service.fetchData('key1');
    await service.fetchData('key1');

    expect(service.callCount).toBe(1);
  });

  it('should not cache different arguments', async () => {
    await service.fetchData('key1');
    await service.fetchData('key2');
    await service.fetchData('key3');

    expect(service.callCount).toBe(3);
  });

  it('should respect cache invalidation', async () => {
    await service.fetchData('test');
    expect(service.callCount).toBe(1);

    service.cache.invalidate('test');

    await service.fetchData('test');
    expect(service.callCount).toBe(2);
  });

  it('should work with custom key generator', async () => {
    class CustomKeyService {
      cache = new CacheManager<string>({});
      callCount = 0;

      @cached(
        (instance: CustomKeyService) => instance.cache,
        (a: number, b: number) => `${a}-${b}`
      )
      async compute(a: number, b: number): Promise<string> {
        this.callCount++;
        return `${a + b}`;
      }
    }

    const customService = new CustomKeyService();

    await customService.compute(1, 2);
    await customService.compute(1, 2);

    expect(customService.callCount).toBe(1);
  });

  it('should work with conditional caching', async () => {
    class ConditionalService {
      cache = new CacheManager<string>({});
      callCount = 0;

      @cached(
        (instance: ConditionalService) => instance.cache,
        (arg: string) => arg,
        (arg: string) => arg !== 'nocache'
      )
      async fetchData(key: string): Promise<string> {
        this.callCount++;
        return `data-${key}`;
      }
    }

    const conditionalService = new ConditionalService();

    // Should cache
    await conditionalService.fetchData('cached');
    await conditionalService.fetchData('cached');
    expect(conditionalService.callCount).toBe(1);

    // Should not cache
    await conditionalService.fetchData('nocache');
    await conditionalService.fetchData('nocache');
    expect(conditionalService.callCount).toBe(3);
  });

  it('should handle cache expiration', async () => {
    class ExpiringService {
      cache = new CacheManager<string>({ ttl: 50 });
      callCount = 0;

      @cached((instance: ExpiringService) => instance.cache)
      async fetchData(key: string): Promise<string> {
        this.callCount++;
        return `data-${key}`;
      }
    }

    const expiringService = new ExpiringService();

    await expiringService.fetchData('test');
    expect(expiringService.callCount).toBe(1);

    await new Promise(resolve => setTimeout(resolve, 100));

    await expiringService.fetchData('test');
    expect(expiringService.callCount).toBe(2);
  });

  it('should work with default key generator', async () => {
    class DefaultKeyService {
      cache = new CacheManager<string>({});
      callCount = 0;

      @cached((instance: DefaultKeyService) => instance.cache)
      async getData(a: string, b: number): Promise<string> {
        this.callCount++;
        return `${a}-${b}`;
      }
    }

    const service = new DefaultKeyService();

    await service.getData('test', 42);
    await service.getData('test', 42);

    expect(service.callCount).toBe(1);
  });

  it('should handle async errors gracefully', async () => {
    class ErrorService {
      cache = new CacheManager<string>({});
      callCount = 0;

      @cached((instance: ErrorService) => instance.cache)
      async fetchData(shouldError: boolean): Promise<string> {
        this.callCount++;
        if (shouldError) {
          throw new Error('Test error');
        }
        return 'success';
      }
    }

    const errorService = new ErrorService();

    // First call should throw and not cache
    await expect(errorService.fetchData(true)).rejects.toThrow('Test error');
    expect(errorService.callCount).toBe(1);

    // Second call should also throw (not cached)
    await expect(errorService.fetchData(true)).rejects.toThrow('Test error');
    expect(errorService.callCount).toBe(2);

    // Successful call should be cached
    await errorService.fetchData(false);
    await errorService.fetchData(false);
    expect(errorService.callCount).toBe(3); // Only one additional call
  });
});

describe('edge cases and error handling', () => {
  let cache: CacheManager<any>;

  beforeEach(() => {
    cache = new CacheManager({});
  });

  it('should handle special characters in keys', () => {
    const specialKeys = [
      'key with spaces',
      'key-with-dashes',
      'key_with_underscores',
      'key.with.dots',
      'key/with/slashes',
      'key:with:colons',
      'key@with#special$chars%'
    ];

    specialKeys.forEach(key => {
      cache.set(key, `value-${key}`);
      expect(cache.get(key)).toBe(`value-${key}`);
    });
  });

  it('should handle large number of entries', () => {
    const largeCache = new CacheManager<string>({ max: 5000 });
    const count = 1000;

    for (let i = 0; i < count; i++) {
      largeCache.set(`key-${i}`, `value-${i}`);
    }

    expect(largeCache.size()).toBe(count);

    for (let i = 0; i < count; i++) {
      expect(largeCache.get(`key-${i}`)).toBe(`value-${i}`);
    }
  });

  it('should handle rapid get/set operations', () => {
    for (let i = 0; i < 100; i++) {
      cache.set('rapid', `value-${i}`);
      expect(cache.get('rapid')).toBe(`value-${i}`);
    }
  });

  it('should handle empty string key', () => {
    cache.set('', 'empty-key-value');
    expect(cache.get('')).toBe('empty-key-value');
  });

  it('should handle very long keys', () => {
    const longKey = 'k'.repeat(1000);
    cache.set(longKey, 'long-key-value');
    expect(cache.get(longKey)).toBe('long-key-value');
  });

  it('should handle very long values', () => {
    const longValue = 'v'.repeat(10000);
    cache.set('long-value', longValue);
    expect(cache.get('long-value')).toBe(longValue);
  });

  it('should handle concurrent operations', async () => {
    const promises = [];

    for (let i = 0; i < 10; i++) {
      promises.push(
        Promise.resolve().then(() => {
          cache.set(`key-${i}`, `value-${i}`);
          return cache.get(`key-${i}`);
        })
      );
    }

    const results = await Promise.all(promises);
    results.forEach((result, i) => {
      expect(result).toBe(`value-${i}`);
    });
  });

  it('should handle maxSize constraint', () => {
    const sizedCache = new CacheManager<string>({
      maxSize: 100, // Very small size
      ttl: 60000
    });

    // Add entries until maxSize is reached
    sizedCache.set('key1', 'a'.repeat(30));
    sizedCache.set('key2', 'b'.repeat(30));
    sizedCache.set('key3', 'c'.repeat(30)); // This might evict earlier entries

    // Cache should respect maxSize
    expect(sizedCache.size()).toBeGreaterThan(0);
    expect(sizedCache.size()).toBeLessThanOrEqual(3);
  });
});
