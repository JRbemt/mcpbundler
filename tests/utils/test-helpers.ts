/**
 * Test utilities and helpers for bundler tests
 */

import { vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { BearerTokenAuthProvider } from '../../src/client/bearer-auth.js';
import { CollectionResponse } from '../../src/config/schemas.js';

/**
 * Create a mock Express app for testing
 */
export function createMockApp(): express.Application {
  const app = express();
  app.use(express.json());
  return app;
}

/**
 * Mock logger to suppress logs during tests
 */
export const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

/**
 * Create a test request with bearer token
 */
export function createAuthenticatedRequest(app: express.Application, token: string) {
  return request(app)
    .get('/sse')
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'text/event-stream');
}

/**
 * Create a test request without authentication
 */
export function createUnauthenticatedRequest(app: express.Application) {
  return request(app)
    .get('/sse')
    .set('Accept', 'text/event-stream');
}

/**
 * Create a properly configured SSEClientTransport with bearer token
 */
export function createAuthenticatedTransport(url: string, token: string) {
  const { SSEClientTransport } = require('@modelcontextprotocol/sdk/client/sse.js');
  return new SSEClientTransport(new URL(url), {
    authProvider: new BearerTokenAuthProvider(token)
  });
}

/**
 * Mock upstream configuration
 */
export const mockUpstreamConfig = {
  namespace: 'test-files',
  bundlerId: 'test-bundler',
  url: 'http://localhost:3001/sse',
  author: 'Test Author',
  description: 'Test MCP server for unit tests',
  version: '1.0.0',
  stateless: false,
  token_cost: 0.001
};

/**
 * Mock collection response
 */
export const mockCollectionResponse: CollectionResponse = {
  collection_id: 'test-collection-id',
  user_id: 'test-user-id',
  name: 'Test Collection',
  permissions: {
    can_call_tools: true,
    can_read_resources: true,
    can_use_prompts: true,
    can_manage_collection: false
  },
  upstreams: [mockUpstreamConfig]
};

/**
 * Wait for a specified amount of time (for async operations)
 */
export const waitFor = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Create a mock Session class for testing
 */
export class MockSession {
  transport: any;
  upstreams: any[] = [];

  constructor(transport: any) {
    this.transport = transport;
  }

  async connect() {
    // Mock connection
    return Promise.resolve();
  }

  async close() {
    // Mock close
    return Promise.resolve();
  }

  attach(upstream: any) {
    this.upstreams.push(upstream);
  }

  async listTools() {
    return { tools: [] };
  }

  async callTool(params: any) {
    return { result: 'mock result' };
  }

  async listResources() {
    return { resources: [] };
  }

  async readResource(params: any) {
    return { content: 'mock content' };
  }

  async listPrompts() {
    return { prompts: [] };
  }

  async getPrompt(params: any) {
    return { prompt: 'mock prompt' };
  }

  async listResourceTemplates() {
    return { resourceTemplates: [] };
  }
}

/**
 * Mock SSE Transport for testing
 */
export class MockSSEServerTransport {
  sessionId: string;
  response: any;

  constructor(path: string, response: any) {
    this.sessionId = `test-session-${Date.now()}`;
    this.response = response;
  }

  async handlePostMessage(req: any, res: any) {
    res.status(200).json({ success: true });
  }
}

/**
 * Create mock MCP Server for testing
 */
export function createMockMCPServer() {
  const server = {
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  };

  return server;
}

/**
 * Environment setup helpers
 */
export const testEnv = {
  setup: () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'silent';
  },

  cleanup: () => {
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
  }
};

/**
 * Assert that a function throws with a specific message
 */
export async function assertThrows(
  fn: () => Promise<any>,
  expectedMessage?: string
): Promise<void> {
  try {
    await fn();
    throw new Error('Expected function to throw');
  } catch (error: any) {
    if (expectedMessage && error.message !== expectedMessage) {
      throw new Error(`Expected error message "${expectedMessage}", got "${error.message}"`);
    }
  }
}