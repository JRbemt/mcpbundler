/**
 * Cacheable - LRU caching utilities and method decorators
 *
 * Provides generic LRU cache manager with size-based eviction and TTL support.
 * Includes @cached decorator for transparent method-level caching with custom
 * key generation and conditional caching logic.
 *
 * Default limits: 1000 entries, 50MB total size, 5 minute TTL. Size calculated
 * via JSON.stringify for automatic memory management.
 */

import logger from "./logger.js";
import { LRUCache } from "lru-cache";

/**
 * Generic cache manager for different data types with LRU eviction
 */
export class CacheManager<T extends {}> {
    private cache: LRUCache<string, T>;

    constructor(options?: Partial<LRUCache.Options<string, T, unknown>>) {
        const defaultOptions: LRUCache.Options<string, T, unknown> = {
            max: 1000,
            maxSize: 50 * 1024 * 1024,
            ttl: 5 * 60 * 1000,
            updateAgeOnGet: true,
            sizeCalculation: (value) => {
                try {
                    return JSON.stringify(value).length;
                } catch {
                    return 1024;
                }
            },
            dispose: (value, key, reason) => {
                logger.debug({ key, reason }, "Cache entry evicted");
            }
        };

        const finalOptions = { ...defaultOptions, ...options };
        this.cache = new LRUCache<string, T>(finalOptions);
    }
    get(key: string): T | undefined {
        return this.cache.get(key)
    }

    set(key: string, value: T, ttl?: number) {
        this.cache.set(key, value, { ttl });
    }

    invalidate(key?: string) {
        if (key) {
            this.cache.delete(key);
        } else {
            this.cache.clear();
        }
    }

    has(key: string): boolean {
        return this.cache.has(key)
    }

    size(): number {
        return this.cache.size
    }

    keys(): string[] {
        return [...this.cache.keys()];
    }
}


// Type for the cache getter function
export type CacheGetter<TInstance, TValue extends {}> = (instance: TInstance) => CacheManager<TValue>;

// Type for the key generation function
export type KeyGenerator<TArgs extends any[]> = (...args: TArgs) => string;

// Type for the cache condition function
export type CacheCondition<TArgs extends any[]> = (...args: TArgs) => boolean;

/**
 * Decorator for caching method results
 */
export function cached<
    TInstance,
    TValue extends {},
    TArgs extends any[]
>(
    getCache: CacheGetter<TInstance, TValue>,
    keyFn: KeyGenerator<TArgs> = (...args: TArgs) => JSON.stringify(args),
    shouldCache: CacheCondition<TArgs> = (...args: TArgs) => true
) {
    return function <T extends TInstance>(
        target: T,
        propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<TValue>>
    ) {
        const original = descriptor.value!;

        descriptor.value = async function (this: T, ...args: TArgs[]): Promise<TValue> {
            const cache = getCache(this);
            const key = keyFn(...args as any);

            if (shouldCache(...args as any)) {
                const cachedValue = cache.get(key);
                if (cachedValue !== undefined) {
                    logger.debug({ method: propertyKey }, `Cache hit for ${propertyKey.toString()}`);
                    return cachedValue;
                }
            }

            logger.debug({ method: propertyKey }, `Cache miss for ${propertyKey.toString()}`);
            const result = await original.apply(this, args as any);

            if (shouldCache(...args as any)) {
                cache.set(key, result);
            }

            return result;
        };
        return descriptor;
    };
}