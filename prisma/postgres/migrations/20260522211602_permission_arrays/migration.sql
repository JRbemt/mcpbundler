/*
  Warnings:

  - The `default_self_service_permissions` column on the `global_settings` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `api_user_permission` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "api_user_permission" DROP CONSTRAINT "api_user_permission_user_id_fkey";

-- AlterTable
ALTER TABLE "api_user" ADD COLUMN     "permissions" "PermissionType"[];

-- AlterTable
ALTER TABLE "global_settings" DROP COLUMN "default_self_service_permissions",
ADD COLUMN     "default_self_service_permissions" "PermissionType"[] DEFAULT ARRAY[]::"PermissionType"[];

-- DropTable
DROP TABLE "api_user_permission";
