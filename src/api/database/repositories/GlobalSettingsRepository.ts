import { PrismaClient, PermissionType } from '@prisma/client';

export class GlobalSettingsRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get global settings, creating default settings if they don't exist
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
