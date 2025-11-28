import { Request, Response, NextFunction } from 'express';
import { PrismaClient, PermissionType } from '@prisma/client';
import { ApiUserRepository } from '../database/repositories/ApiUserRepository.js';
import logger from '../../utils/logger.js';
import { auditApiLog, AuditApiAction } from '../../utils/audit-log.js';
import { API_KEY_PREFIX } from '../../utils/encryption.js';
import { AsyncLocalStorage } from 'async_hooks';



export const STORE = new AsyncLocalStorage<Request>();

/**
 * Middleware to authenticate management API requests
 * Validates Authorization: Bearer header with admin API keys
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
        details: { path: req.path, method: req.method, tokenPrefix: token.substring(0, 10) },
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
          details: { path: req.path, method: req.method, keyPrefix: token.substring(0, 15) },
        }, req);

        res.status(401).json({
          error: 'Invalid API key',
          message: 'The provided API key is invalid or has been revoked',
        });
        return;
      }

      const userWithPermissions = await prisma.apiUser.findUnique({
        where: { id: apiUser.id },
        include: { permissions: true }
      });

      if (!userWithPermissions) {
        logger.error({ userId: apiUser.id }, 'User not found after validation');
        res.status(500).json({
          error: 'Internal server error',
          message: 'An error occurred during authentication',
        });
        return;
      }

      req.apiAuth = {
        userId: apiUser.id,
        apiKey: apiUser.keyHash,
        apiKeyName: apiUser.name,
        contact: apiUser.contact,
        isAdmin: apiUser.isAdmin,
        permissions: userWithPermissions.permissions.map(p => p.permission),
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
            permissions: userWithPermissions.permissions.map(p => p.permission)
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
 * Helper function to check if the authenticated user has at least one of the specified permissions.
 * Admins automatically pass all permission checks.
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
 * Helper function to check if the authenticated user is an admin.
 */
export function isAdmin(req: Request): boolean {
  return req.apiAuth?.isAdmin ?? false;
}
