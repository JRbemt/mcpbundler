/**
 * Express Type Extensions - Type definitions for Express request augmentation
 *
 * Extends Express Request interface with apiAuth property populated by auth
 * middleware. Contains authenticated user info, permissions, and API key details.
 */

import "express-serve-static-core";
import { PermissionType } from "../shared/domain/entities.js";

export interface ApiUserRequest {
    userId: string;
    apiKey: string;
    apiKeyName: string;
    contact: string;
    isAdmin: boolean;
    permissions: PermissionType[];
    createdById: string | null;
}

// Extend Express Request interface to include 'auth' (middleware) and validated body
declare module "express-serve-static-core" {
    interface Request {
        apiAuth?: ApiUserRequest;
        /** Validated request body from validateBody middleware */
        validated?: unknown;
    }
}