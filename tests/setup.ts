/**
 * Global test setup for bundler tests
 * This file is loaded before all tests and provides global configuration
 */

import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock console methods to reduce test noise
const originalConsole = { ...console };

// Setup MSW server for mocking HTTP requests
export const server = setupServer();

// Test configuration
export const TEST_CONFIG = {
  BACKEND_URL: 'http://localhost:8000',
  BUNDLER_URL: 'http://localhost:3009',
  TEST_TIMEOUT: 10000,
  TOKEN_EXPIRY_HOURS: 24,
};

// Mock backend responses
export const mockBackendHandlers = [
  // Mock collection resolution endpoint
  http.get(`${TEST_CONFIG.BACKEND_URL}/api/collections/resolve/:token`, ({ params }) => {
    const { token } = params;

    if (token === 'invalid-token') {
      return HttpResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    if (token === 'expired-token') {
      return HttpResponse.json(
        { error: 'Token expired' },
        { status: 401 }
      );
    }

    // Valid token response
    return HttpResponse.json({
      id: 'test-collection-id',
      name: 'Test Collection',
      description: 'A test collection',
      upstreams: [
        {
          namespace: 'test-files',
          bundlerId: 'test-collection-id',
          url: 'http://localhost:3001/sse',
          version: '1.0.0',
          stateless: false
        }
      ]
    });
  }),

  // Mock collection endpoints
  http.post(`${TEST_CONFIG.BACKEND_URL}/api/collections/`, () => {
    return HttpResponse.json({
      id: 'new-collection-id',
      name: 'New Collection',
      description: 'A new test collection',
      owner_id: 'test-user-id'
    });
  }),

  http.get(`${TEST_CONFIG.BACKEND_URL}/api/collections/`, () => {
    return HttpResponse.json([
      {
        id: 'collection-1',
        name: 'Collection 1',
        description: 'First collection',
        owner_id: 'test-user-id'
      }
    ]);
  }),
];

// Global test setup
beforeAll(() => {
  // Start MSW server
  server.listen({ onUnhandledRequest: 'warn' });

  // Mock console methods during tests (unless explicitly enabled)
  if (!process.env.TEST_VERBOSE) {
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'info').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
    vi.spyOn(console, 'error').mockImplementation(() => { });
  }
});

// Reset handlers after each test
afterEach(() => {
  server.resetHandlers();
  vi.clearAllMocks();
});

// Clean up after all tests
afterAll(() => {
  server.close();

  // Restore console methods
  Object.assign(console, originalConsole);
});

// Global test utilities
export const createMockToken = (collectionId: string = 'test-collection-id') => {
  const tokenData = {
    collection_id: collectionId,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };

  return Buffer.from(JSON.stringify(tokenData)).toString('base64').replace(/=/g, '');
};

export const createExpiredToken = (collectionId: string = 'test-collection-id') => {
  const tokenData = {
    collection_id: collectionId,
    issued_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  };

  return Buffer.from(JSON.stringify(tokenData)).toString('base64').replace(/=/g, '');
};

// Mock EventSource for SSE testing
class MockEventSource {
  url: string;
  readyState: number = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate connection opening after a tick
    setTimeout(() => {
      this.readyState = 1;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  close() {
    this.readyState = 2;
  }

  // Helper method for tests to simulate messages
  simulateMessage(data: string) {
    if (this.onmessage && this.readyState === 1) {
      const event = new MessageEvent('message', { data });
      this.onmessage(event);
    }
  }

  // Helper method for tests to simulate errors
  simulateError() {
    if (this.onerror && this.readyState === 1) {
      this.onerror(new Event('error'));
    }
  }
}

// Replace global EventSource with mock
(globalThis as any).EventSource = MockEventSource;