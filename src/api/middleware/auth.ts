/**
 * Authentication Middleware - Management API security layer
 *
 * Provides authentication and authorization for the management REST API using
 * Bearer token authentication with admin API keys. This middleware validates
 * API keys, tracks usage, enforces permissions, and provides comprehensive
 * audit logging.
 *
 * Authentication flow:
 * 1. Extract Bearer token from Authorization header
 * 2. Validate token format (must start with API_KEY_PREFIX)
 * 3. Look up API key in database and verify it's not revoked
 * 4. Update lastUsedAt timestamp
 * 5. Load user permissions
 * 6. Attach user context to req.apiAuth
 * 7. Log authentication event for audit trail
 *
 * Security features:
 * - SHA-256 hashed key storage (never plaintext in database)
 * - Automatic key revocation support
 * - Permission-based access control (admins bypass all checks)
 * - Comprehensive audit logging of all auth events
 * - AsyncLocalStorage for request context propagation
 *
 * Response codes:
 * - 401: Missing, invalid, or revoked API key
 * - 500: Internal authentication error
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient, PermissionType } from '@prisma/client';
import { ApiUserRepository } from '../database/repositories/ApiUserRepository.js';
import logger from '../../utils/logger.js';
import { auditApiLog, AuditApiAction } from '../../utils/audit-log.js';
import { API_KEY_PREFIX } from '../../core/auth/encryption.js';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * AsyncLocalStorage for request context propagation
 * Allows audit logging to access request context from anywhere in the call stack
 */
export const STORE = new AsyncLocalStorage<Request>();
/**
 * Create authentication middleware for management API
 *
 * Factory function that creates Express middleware for authenticating API requests.
 * The middleware validates Bearer tokens, loads user permissions, and attaches
 * authentication context to the request object.
 *
 * Usage:
 * ```typescript
 * const authMiddleware = createAuthMiddleware(prisma);
 * app.use('/api', authMiddleware);
 * ```
 *
 * @param prisma - Prisma client instance for database access
 * @returns Express middleware function
 */
export function createAuthMiddleware(prisma: PrismaClient) {
  const apiKeyRepo = new ApiUserRepository(prisma);

  return async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Missing Authorization header',
        details: { path: req.path, method: req.method },
      }, req);

      res.status(401).json({
        error: 'Authentication required',
        message: 'Authorization header with Bearer token is required for management API access',
      });
      return;
    }

    // Descriptive error: not usigng Bearer 
    if (!authHeader.startsWith('Bearer ')) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Invalid Authorization header format',
        details: { path: req.path, method: req.method },
      }, req);

      res.status(401).json({
        error: 'Invalid authentication format',
        message: 'Authorization header must use Bearer token format',
      });
      return;
    }

    const token = authHeader.substring(7);

    // Descriptive error: wrong token (format)
    if (!token.startsWith(API_KEY_PREFIX)) {
      auditApiLog({
        action: AuditApiAction.AUTH_FAILURE,
        success: false,
        errorMessage: 'Invalid token type - expected admin API key',
        details: { path: req.path, method: req.method },
      }, req);

      res.status(401).json({
        error: 'Invalid token type',
        message: `Management API requires admin API key (${API_KEY_PREFIX}*)`,
      });
      return;
    }

    try {
      const apiUser = await apiKeyRepo.validateAndUpdate(token);

      if (!apiUser) {
        auditApiLog({
          action: AuditApiAction.AUTH_FAILURE,
          success: false,
          errorMessage: 'Invalid or revoked API key',
          details: { path: req.path, method: req.method },
        }, req);

        res.status(401).json({
          error: 'Invalid API key',
          message: 'The provided API key is invalid or has been revoked',
        });
        return;
      }
      req.apiAuth = {
        userId: apiUser.id,
        apiKey: apiUser.keyHash,
        apiKeyName: apiUser.name,
        contact: apiUser.contact,
        isAdmin: apiUser.isAdmin,
        permissions: apiUser.permissions.map(p => p.permission),
        createdById: apiUser.createdById
      };


      STORE.run(req, () => {
        auditApiLog({
          action: AuditApiAction.AUTH_SUCCESS,
          success: true,
          details: {
            path: req.path,
            method: req.method,
            userId: apiUser.id,
            isAdmin: apiUser.isAdmin,
            permissions: apiUser.permissions.map(p => p.permission)
          },
        }, req);
        next();
      })

    } catch (error) {
      logger.error({ error, path: req.path }, 'Error during API key validation');
      res.status(500).json({
        error: 'Internal server error',
        message: 'An error occurred during authentication',
      });
    }
  };
}

/**
 * Check if authenticated user has at least one of the specified permissions
 *
 * Helper function for permission-based access control in route handlers.
 * Admin users automatically pass all permission checks.
 *
 * @param req - Express request object (must have req.apiAuth populated by auth middleware)
 * @param permissions - One or more permission types to check for
 * @returns True if user is admin OR has at least one of the specified permissions
 *
 * @example
 * ```typescript
 * if (!hasPermission(req, PermissionType.USER_CREATE)) {
 *   return res.status(403).json({ error: 'Insufficient permissions' });
 * }
 * ```
 */
export function hasPermission(req: Request, ...permissions: PermissionType[]): boolean {
  if (!req.apiAuth) {
    return false;
  }

  if (req.apiAuth.isAdmin) {
    return true;
  }

  return permissions.some(p => req.apiAuth!.permissions.includes(p));
}

/**
 * Check if authenticated user is an admin
 *
 * Helper function to check admin status. Admins have unrestricted access
 * to all management API operations.
 *
 * @param req - Express request object (must have req.apiAuth populated by auth middleware)
 * @returns True if user is an admin, false otherwise
 */
export function isAdmin(req: Request): boolean {
  return req.apiAuth?.isAdmin ?? false;
}
