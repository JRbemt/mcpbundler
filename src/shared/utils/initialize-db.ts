/**
 * Initialize System - Startup data initialization
 *
 * Idempotent system initialization that runs on startup. Creates root admin user
 * if none exists and initializes global settings for self-service mode. Root user
 * API key is printed to console once and never shown again.
 *
 * Safe to run on every startup - checks for existing admin before creating.
 */

import { PermissionType, PrismaClient } from "@prisma/client";
import logger from "./logger.js";
import { auditApiLog, AuditApiAction } from "./audit-log.js";
import { ApiUserRepository, GlobalSettingsRepository } from "../infra/repository/index.js";


export interface SystemInitConfig {
    rootUser: {
        name: string;
        email: string;
    };
    selfService: {
        enabled: boolean;
        defaultPermissions: PermissionType[];
    };
}

/**
 * Initializes system data on startup
 * Creates root administrator user if none exists! Ensures there is always an isAdmin account
 * Initializes global settings from provided configuration

 */
export async function initializeSystemData(prisma: PrismaClient, config: SystemInitConfig): Promise<void> {
    logger.info("Initializing system data");

    try {
        // Initialize/update global settings from config
        const settingsRepo = new GlobalSettingsRepository(prisma);
        await settingsRepo.updateSelfServiceSettings(
            config.selfService.enabled,
            config.selfService.defaultPermissions
        );

        logger.info({
            allowSelfService: config.selfService.enabled,
            defaultSelfServicePermissions: config.selfService.defaultPermissions
        }, "Global settings initialized");

        // Check if any admin users exist
        const existingAdmin = await prisma.apiUser.findFirst({
            where: {
                isAdmin: true,
                revokedAt: null
            }
        });

        if (existingAdmin) {
            logger.info({ adminName: existingAdmin.name }, "Root administrator already exists");
            return;
        }

        // No admin exists - create root user
        logger.warn("No administrator found, creating root user");

        const userRepo = new ApiUserRepository(prisma);
        const { record, key } = await userRepo.createWithPermissions({
            name: config.rootUser.name,
            contact: config.rootUser.email,
            isAdmin: true,
            department: "Administration",
            revokedAt: null,
            createdById: null,
        }, Object.values(PermissionType));

        // Log to audit log
        auditApiLog({
            action: AuditApiAction.USER_CREATE,
            apiKeyId: "system",
            apiKeyName: "system",
            ip: "localhost",
            userAgent: "initialization",
            success: true,
            details: {
                userId: record.id,
                userName: record.name,
                isAdmin: true,
            }
        });
        const n_stripes = 120;
        // Display API key to console (only shown once)
        console.log("\n" + "=".repeat(n_stripes));
        console.log("ROOT ADMINISTRATOR CREATED");
        console.log("=".repeat(n_stripes));
        console.log(`Name:    ${record.name}`);
        console.log(`Contact: ${record.contact}`);
        console.log(`API Key: ${key}`);
        console.log("=".repeat(n_stripes));
        console.log("IMPORTANT: Save this API key securely. It will not be shown again.");
        console.log("=".repeat(n_stripes) + "\n");

        logger.info({
            userId: record.id,
            userName: record.name,
            contact: record.contact
        }, "Root administrator created successfully");

    } catch (error) {
        logger.error({ error }, "Failed to initialize system data");
        throw error;
    }
}

/**
 * Parse comma-separated permission types from environment variable
 */
export function parsePermissions(value: string | undefined): PermissionType[] {
    if (!value || value.trim() === "") {
        return [];
    }

    const parts = value.split(",").map(p => p.trim()).filter(p => p !== "");
    const validPermissions: PermissionType[] = [];
    const invalidPermissions: string[] = [];

    const validPermissionValues = Object.values(PermissionType);

    for (const part of parts) {
        if (validPermissionValues.includes(part as PermissionType)) {
            validPermissions.push(part as PermissionType);
        } else {
            invalidPermissions.push(part);
        }
    }

    if (invalidPermissions.length > 0) {
        logger.error({ invalidPermissions }, `Invalid permissions: ${invalidPermissions}`);
        throw new Error(`Invalid permissions: ${invalidPermissions}`);
    }

    return validPermissions;
}