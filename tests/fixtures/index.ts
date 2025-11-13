/**
 * Test fixtures for consistent test data
 */

import { UpstreamConfig, CollectionResponse } from '../../src/config/schemas.js';

/**
 * Sample upstream configurations
 */
export const upstreamFixtures: Record<string, UpstreamConfig> = {
  files: {
    namespace: 'files',
    bundlerId: 'test-bundler-id',
    url: 'http://localhost:3001/sse',
    author: 'Test Author',
    description: 'File system MCP for testing',
    version: '1.0.0',
    stateless: false,
    token_cost: 0.001
  },

  database: {
    namespace: 'database',
    bundlerId: 'test-bundler-id',
    url: 'http://localhost:3002/sse',
    author: 'Test Author',
    description: 'Database MCP for testing',
    version: '2.0.0',
    stateless: true,
    token_cost: 0.001
  },

  api: {
    namespace: 'api',
    bundlerId: 'test-bundler-id',
    url: 'http://localhost:3003/sse',
    author: 'Test Author',
    description: 'API MCP for testing',
    version: '1.5.0',
    stateless: false,
    token_cost: 0.001
  }
};

/**
 * Sample collection responses
 */
export const collectionFixtures: Record<string, CollectionResponse> = {
  simple: {
    collection_id: 'collection-simple',
    user_id: 'test-user-1',
    name: 'Simple Collection',
    permissions: {
      can_call_tools: true,
      can_read_resources: true,
      can_use_prompts: true,
      can_manage_collection: false
    },
    upstreams: [upstreamFixtures.files]
  },

  multiple: {
    collection_id: 'collection-multiple',
    user_id: 'test-user-1',
    name: 'Multiple Upstreams Collection',
    permissions: {
      can_call_tools: true,
      can_read_resources: true,
      can_use_prompts: true,
      can_manage_collection: false
    },
    upstreams: [
      upstreamFixtures.files,
      upstreamFixtures.database,
      upstreamFixtures.api
    ]
  },

  empty: {
    collection_id: 'collection-empty',
    user_id: 'test-user-1',
    name: 'Empty Collection',
    permissions: {
      can_call_tools: true,
      can_read_resources: true,
      can_use_prompts: true,
      can_manage_collection: false
    },
    upstreams: []
  }
};

/**
 * Sample bearer tokens
 */
export const tokenFixtures = {
  valid: (() => {
    const tokenData = {
      collection_id: 'collection-simple',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };
    return Buffer.from(JSON.stringify(tokenData)).toString('base64').replace(/=/g, '');
  })(),
  
  expired: (() => {
    const tokenData = {
      collection_id: 'collection-simple',
      issued_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    };
    return Buffer.from(JSON.stringify(tokenData)).toString('base64').replace(/=/g, '');
  })(),
  
  invalid: 'invalid-token-format',
  
  malformed: 'not-base64-encoded!@#$%'
};

/**
 * Sample error responses
 */
export const errorFixtures = {
  invalidToken: {
    status: 401,
    body: { error: 'Invalid or expired bearer token' }
  },
  
  collectionNotFound: {
    status: 404,
    body: { error: 'Collection not found' }
  },
  
  backendUnavailable: {
    status: 503,
    body: { error: 'Backend service unavailable' }
  },
  
  tooManySessions: {
    status: 503,
    body: { error: 'Too many active sessions' }
  }
};

/**
 * Sample MCP request/response data
 */
export const mcpFixtures = {
  listToolsRequest: {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  },
  
  listToolsResponse: {
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        {
          name: 'read_file',
          description: 'Read a file from the filesystem',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' }
            },
            required: ['path']
          }
        }
      ]
    }
  },
  
  callToolRequest: {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'read_file',
      arguments: {
        path: '/test/file.txt'
      }
    }
  },
  
  callToolResponse: {
    jsonrpc: '2.0',
    id: 2,
    result: {
      content: [
        {
          type: 'text',
          text: 'File content here'
        }
      ]
    }
  }
};

/**
 * Sample bundler configuration
 */
export const configFixtures = {
  default: {
    name: 'Test MCP Bundler',
    version: '0.1.0',
    host: '127.0.0.1',
    port: 3009,
    concurrency: {
      max_sessions: 10,
      idle_timeout_ms: 5 * 60 * 1000,
      startup_block_ms: 100
    }
  },
  
  production: {
    name: 'MCP Bundler',
    version: '1.0.0',
    host: '0.0.0.0',
    port: 3009,
    concurrency: {
      max_sessions: 100,
      idle_timeout_ms: 10 * 60 * 1000,
      startup_block_ms: 1000
    }
  }
};