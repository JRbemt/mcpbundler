/*
  Warnings:

  - You are about to drop the `bundle_token_mcp_credential` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[path]` on the table `bundles` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "bundle_token_mcp_credential" DROP CONSTRAINT "bundle_token_mcp_credential_mcp_id_fkey";

-- DropForeignKey
ALTER TABLE "bundle_token_mcp_credential" DROP CONSTRAINT "bundle_token_mcp_credential_token_id_fkey";

-- AlterTable
ALTER TABLE "bundle_access_tokens" ADD COLUMN     "pin_version" INTEGER,
ADD COLUMN     "router_config" TEXT,
ADD COLUMN     "subscription_id" TEXT;

-- AlterTable
ALTER TABLE "bundles" ADD COLUMN     "is_published" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "path" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- DropTable
DROP TABLE "bundle_token_mcp_credential";

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "credentials" TEXT,
    "router_config" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'openai-compatible',
    "model" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "description" TEXT,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "max_tokens" INTEGER NOT NULL DEFAULT 256,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_llm_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_llm_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_created_by_id_idx" ON "subscriptions"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_name_created_by_id_key" ON "subscriptions"("name", "created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "llm_providers_name_key" ON "llm_providers"("name");

-- CreateIndex
CREATE INDEX "user_llm_credentials_user_id_idx" ON "user_llm_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_llm_credentials_user_id_provider_id_key" ON "user_llm_credentials"("user_id", "provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "bundles_path_key" ON "bundles"("path");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "api_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_access_tokens" ADD CONSTRAINT "bundle_access_tokens_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_llm_credentials" ADD CONSTRAINT "user_llm_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "api_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_llm_credentials" ADD CONSTRAINT "user_llm_credentials_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "llm_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
