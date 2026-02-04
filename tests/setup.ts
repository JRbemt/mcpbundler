/**
 * Global test setup for vitest
 *
 * Configures environment variables and mocks required across all test suites.
 */

import { vi } from "vitest";

// Set encryption key for encryption-related tests
process.env.ENCRYPTION_KEY = "test-encryption-key-must-be-at-least-32-chars-long";

// Mock the logger to suppress output during tests
vi.mock("../src/shared/utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

// Mock @prisma/client to avoid requiring generated Prisma client for unit tests.
// All named exports referenced by the application code must be present.
vi.mock("@prisma/client", () => ({
  PrismaClient: vi.fn(),
  Prisma: {},
  AuthStrategy: {
    MASTER: "MASTER",
    USER_SET: "USER_SET",
    NONE: "NONE",
  },
  PermissionType: {
    CREATE_USER: "CREATE_USER",
    ADD_MCP: "ADD_MCP",
    LIST_USERS: "LIST_USERS",
    VIEW_PERMISSIONS: "VIEW_PERMISSIONS",
  },
  BundleAccessToken: {},
  GlobalSettings: {},
  MCPBundleEntry: {},
  BundledMCPCredential: {},
  Mcp: {},
  Bundle: {},
  ApiUser: {},
}));
