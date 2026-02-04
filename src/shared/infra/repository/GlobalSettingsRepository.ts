/**
 * Global Settings Repository - System-wide configuration management
 *
 * Manages global system settings that apply across the entire mcpbundler instance.
 * Uses a singleton pattern with ID 'global' to store system-wide configuration.
 *
 * @see schema.prisma
 */

import { PrismaClient, PermissionType } from "../../domain/entities.js";

export class GlobalSettingsRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get global settings, creating default settings if they don't exist
   *
   * Retrieves the global settings singleton. If no settings exist yet, creates them
   * with secure defaults (self-service disabled, no default permissions).
   *
   * @returns Global settings with parsed permission array
   */
  async get() {
    let settings = await this.prisma.globalSettings.findUnique({
      where: { id: 'global' }
    });

    if (!settings) {
      settings = await this.prisma.globalSettings.create({
        data: {
          id: 'global',
          allowSelfServiceRegistration: false,
          defaultSelfServicePermissions: '[]'
        }
      });
    }

    return {
      ...settings,
      defaultSelfServicePermissions: JSON.parse(settings.defaultSelfServicePermissions) as PermissionType[]
    };
  }

  /**
   * Update self-service registration settings
   *
   * Updates whether self-service registration is allowed and what default permissions
   * new self-service users receive. Uses upsert to create settings if they don't exist.
   *
   * @param enabled - Whether to allow self-service user registration
   * @param defaultPermissions - Array of permissions granted to self-service users by default
   * @returns Updated global settings with parsed permission array
   */
  async updateSelfServiceSettings(enabled: boolean, defaultPermissions: PermissionType[]) {
    const settings = await this.prisma.globalSettings.upsert({
      where: { id: 'global' },
      update: {
        allowSelfServiceRegistration: enabled,
        defaultSelfServicePermissions: JSON.stringify(defaultPermissions)
      },
      create: {
        id: 'global',
        allowSelfServiceRegistration: enabled,
        defaultSelfServicePermissions: JSON.stringify(defaultPermissions)
      }
    });

    return {
      ...settings,
      defaultSelfServicePermissions: JSON.parse(settings.defaultSelfServicePermissions) as PermissionType[]
    };
  }
}
