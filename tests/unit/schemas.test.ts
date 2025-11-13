/**
 * Unit tests for Zod schemas
 */

import { describe, it, expect } from 'vitest';
import { 
  BundlerConfigSchema, 
  UpstreamConfigSchema, 
  CollectionResponseSchema 
} from '../../src/config/schemas.js';

describe('Schemas', () => {
  describe('BundlerConfigSchema', () => {
    it('should validate a valid bundler config', () => {
      const validConfig = {
        name: 'Test Bundler',
        version: '1.0.0',
        host: '0.0.0.0',
        port: 3009
      };

      const result = BundlerConfigSchema.parse(validConfig);
      expect(result).toEqual({
        ...validConfig,
        concurrency: {
          max_sessions: 100,
          idle_timeout_ms: 300000,
          startup_block_ms: 100
        }
      });
    });

    it('should validate config with custom concurrency settings', () => {
      const configWithConcurrency = {
        name: 'Test Bundler',
        version: '1.0.0',
        host: '127.0.0.1',
        port: 8080,
        concurrency: {
          max_sessions: 50,
          idle_timeout_ms: 600000,
          startup_block_ms: 200
        }
      };

      const result = BundlerConfigSchema.parse(configWithConcurrency);
      expect(result).toEqual(configWithConcurrency);
    });

    it('should apply default concurrency values', () => {
      const minimalConfig = {
        name: 'Minimal Bundler',
        version: '0.1.0',
        host: 'localhost',
        port: 3000
      };

      const result = BundlerConfigSchema.parse(minimalConfig);
      expect(result.concurrency).toEqual({
        max_sessions: 100,
        idle_timeout_ms: 300000,
        startup_block_ms: 100
      });
    });

    it('should reject invalid config - missing required fields', () => {
      const invalidConfig = {
        name: 'Test Bundler'
        // Missing version, host, port
      };

      expect(() => BundlerConfigSchema.parse(invalidConfig))
        .toThrow();
    });

    it('should reject invalid config - wrong types', () => {
      const invalidConfig = {
        name: 'Test Bundler',
        version: '1.0.0',
        host: '127.0.0.1',
        port: '3009' // Should be number
      };

      expect(() => BundlerConfigSchema.parse(invalidConfig))
        .toThrow();
    });

    it('should reject invalid concurrency values', () => {
      const invalidConfig = {
        name: 'Test Bundler',
        version: '1.0.0',
        host: '127.0.0.1',
        port: 3009,
        concurrency: {
          max_sessions: 0, // Should be at least 1
          idle_timeout_ms: -1000, // Should be non-negative
          startup_block_ms: -100 // Should be non-negative
        }
      };

      expect(() => BundlerConfigSchema.parse(invalidConfig))
        .toThrow();
    });
  });

  describe('UpstreamConfigSchema', () => {
    it('should validate a valid upstream config', () => {
      const validUpstream = {
        namespace: 'files',
        bundlerId: 'test-bundler',
        url: 'http://localhost:3001/sse',
        version: '1.0.0'
      };

      const result = UpstreamConfigSchema.parse(validUpstream);
      expect(result).toEqual({
        ...validUpstream,
        stateless: false, // default value
        token_cost: 0.001 // default value
      });
    });

    it('should validate upstream with stateless=true', () => {
      const statelessUpstream = {
        namespace: 'api',
        bundlerId: 'test-bundler',
        url: 'https://api.example.com/mcp',
        version: '2.0.0',
        stateless: true
      };

      const result = UpstreamConfigSchema.parse(statelessUpstream);
      expect(result).toEqual({
        ...statelessUpstream,
        token_cost: 0.001 // default value
      });
    });

    it('should reject invalid upstream - empty namespace', () => {
      const invalidUpstream = {
        namespace: '', // Empty string not allowed
        bundlerId: 'test-bundler',
        url: 'http://localhost:3001/sse',
        version: '1.0.0'
      };

      expect(() => UpstreamConfigSchema.parse(invalidUpstream))
        .toThrow();
    });

    it('should reject invalid upstream - empty bundlerId', () => {
      const invalidUpstream = {
        namespace: 'files',
        bundlerId: '', // Empty string not allowed
        url: 'http://localhost:3001/sse',
        version: '1.0.0'
      };

      expect(() => UpstreamConfigSchema.parse(invalidUpstream))
        .toThrow();
    });

    it('should reject invalid upstream - invalid URL', () => {
      const invalidUpstream = {
        namespace: 'files',
        bundlerId: 'test-bundler',
        url: 'not-a-valid-url', // Invalid URL format
        version: '1.0.0'
      };

      expect(() => UpstreamConfigSchema.parse(invalidUpstream))
        .toThrow();
    });

    it('should reject invalid upstream - empty version', () => {
      const invalidUpstream = {
        namespace: 'files',
        bundlerId: 'test-bundler',
        url: 'http://localhost:3001/sse',
        version: '' // Empty string not allowed
      };

      expect(() => UpstreamConfigSchema.parse(invalidUpstream))
        .toThrow();
    });

    it('should accept various URL schemes', () => {
      const urlVariants = [
        'http://localhost:3001/sse',
        'https://secure.example.com/mcp',
        'http://192.168.1.100:8080/api',
        'https://subdomain.example.org:9999/path'
      ];

      urlVariants.forEach(url => {
        const upstream = {
          namespace: 'test',
          bundlerId: 'test-bundler',
          url,
          version: '1.0.0'
        };

        expect(() => UpstreamConfigSchema.parse(upstream))
          .not.toThrow();
      });
    });
  });

  describe('CollectionResponseSchema', () => {
    it('should validate a valid collection response', () => {
      const validCollection = {
        collection_id: 'collection-123',
        user_id: 'user-456',
        name: 'Test Collection',
        permissions: {
          can_call_tools: true,
          can_read_resources: true,
          can_use_prompts: true,
          can_manage_collection: false
        },
        upstreams: [
          {
            namespace: 'files',
            bundlerId: 'test-bundler',
            url: 'http://localhost:3001/sse',
            version: '1.0.0',
            stateless: false,
            token_cost: 0.001
          }
        ]
      };

      const result = CollectionResponseSchema.parse(validCollection);
      expect(result).toEqual(validCollection);
    });

    it('should validate collection with minimal permissions', () => {
      const minimalCollection = {
        collection_id: 'collection-456',
        user_id: 'user-789',
        name: 'Minimal Collection',
        permissions: {
          can_call_tools: false,
          can_read_resources: true,
          can_use_prompts: false,
          can_manage_collection: false
        },
        upstreams: []
      };

      const result = CollectionResponseSchema.parse(minimalCollection);
      expect(result).toEqual(minimalCollection);
    });

    it('should validate collection with empty upstreams array', () => {
      const emptyCollection = {
        collection_id: 'empty-collection',
        user_id: 'user-empty',
        name: 'Empty Collection',
        permissions: {
          can_call_tools: true,
          can_read_resources: true,
          can_use_prompts: true,
          can_manage_collection: true
        },
        upstreams: []
      };

      const result = CollectionResponseSchema.parse(emptyCollection);
      expect(result).toEqual(emptyCollection);
    });

    it('should validate collection with multiple upstreams', () => {
      const multiUpstreamCollection = {
        collection_id: 'multi-collection',
        user_id: 'user-multi',
        name: 'Multi Upstream Collection',
        permissions: {
          can_call_tools: true,
          can_read_resources: true,
          can_use_prompts: true,
          can_manage_collection: false
        },
        upstreams: [
          {
            namespace: 'files',
            bundlerId: 'test-bundler',
            url: 'http://localhost:3001/sse',
            version: '1.0.0',
            stateless: false,
            token_cost: 0.001
          },
          {
            namespace: 'database',
            bundlerId: 'test-bundler',
            url: 'http://localhost:3002/sse',
            version: '2.0.0',
            stateless: true,
            token_cost: 0.001
          }
        ]
      };

      const result = CollectionResponseSchema.parse(multiUpstreamCollection);
      expect(result).toEqual(multiUpstreamCollection);
      expect(result.upstreams).toHaveLength(2);
    });

    it('should reject collection - missing required fields', () => {
      const invalidCollection = {
        name: 'Invalid Collection'
        // Missing collection_id, user_id, permissions, and upstreams
      };

      expect(() => CollectionResponseSchema.parse(invalidCollection))
        .toThrow();
    });

    it('should reject collection - invalid upstream in array', () => {
      const invalidCollection = {
        collection_id: 'collection-789',
        user_id: 'user-invalid',
        name: 'Collection with Invalid Upstream',
        permissions: {
          can_call_tools: true,
          can_read_resources: true,
          can_use_prompts: true,
          can_manage_collection: false
        },
        upstreams: [
          {
            namespace: 'files',
            bundlerId: 'test-bundler',
            // Missing url and version
            stateless: false
          }
        ]
      };

      expect(() => CollectionResponseSchema.parse(invalidCollection))
        .toThrow();
    });

    it('should reject collection - wrong types', () => {
      const invalidCollection = {
        collection_id: 123, // Should be string
        user_id: 'user-123',
        name: 'Test Collection',
        permissions: {
          can_call_tools: true,
          can_read_resources: true,
          can_use_prompts: true,
          can_manage_collection: false
        },
        upstreams: 'not-an-array' // Should be array
      };

      expect(() => CollectionResponseSchema.parse(invalidCollection))
        .toThrow();
    });
  });
});