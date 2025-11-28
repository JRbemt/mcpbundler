import { PermissionType, PrismaClient } from "@prisma/client";
import logger from "./logger.js";
import { GlobalSettingsRepository } from "../api/database/repositories/GlobalSettingsRepository.js";
import { ApiUserRepository } from "../api/database/repositories/ApiUserRepository.js";
import { auditApiLog, AuditApiAction } from "./audit-log.js";


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
 * Creates root administrator user if none exists
 * Initializes global settings from provided configuration
 * Idempotent - safe to run on every startup
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
      defaultPermissions: config.selfService.defaultPermissions
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
    const { apiUser, plaintextKey } = await userRepo.createWithPermissions({
      name: config.rootUser.name,
      contact: config.rootUser.email,
      isAdmin: true,
      permissions: [],
    });

    // Log to audit log
    auditApiLog({
      action: AuditApiAction.USER_CREATE,
      apiKeyId: "system",
      apiKeyName: "system",
      ip: "localhost",
      userAgent: "initialization",
      success: true,
      details: {
        userId: apiUser.id,
        userName: apiUser.name,
        isAdmin: true,
      }
    });

    // Display API key to console (only shown once)
    console.log("\n" + "=".repeat(80));
    console.log("ROOT ADMINISTRATOR CREATED");
    console.log("=".repeat(80));
    console.log(`Name:    ${apiUser.name}`);
    console.log(`Contact: ${apiUser.contact}`);
    console.log(`API Key: ${plaintextKey}`);
    console.log("=".repeat(80));
    console.log("IMPORTANT: Save this API key securely. It will not be shown again.");
    console.log("=".repeat(80) + "\n");

    logger.info({
      userId: apiUser.id,
      userName: apiUser.name,
      contact: apiUser.contact
    }, "Root administrator created successfully");

  } catch (error) {
    logger.error({ error }, "Failed to initialize system data");
    throw error;
  }
}
