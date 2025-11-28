
import "express-serve-static-core";
import { PermissionType } from "@prisma/client";

export interface ApiUserRequest {
    userId: string;
    apiKey: string;
    apiKeyName: string;
    contact: string;
    isAdmin: boolean;
    permissions: PermissionType[];
    createdById: string | null;
}

// Extend Express Request interface to include 'auth' (middleware)
declare module "express-serve-static-core" {
    interface Request {
        apiAuth?: ApiUserRequest;
    }
}