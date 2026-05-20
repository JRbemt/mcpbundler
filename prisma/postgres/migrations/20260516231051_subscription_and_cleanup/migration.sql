-- Drop legacy per-token credential table (superseded by Subscription.credentials)
DROP TABLE IF EXISTS "bundle_token_mcp_credential";

-- CreateTable: subscriptions
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

-- AlterTable: add subscription_id to bundle_access_tokens
ALTER TABLE "bundle_access_tokens" ADD COLUMN "subscription_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_name_created_by_id_key" ON "subscriptions"("name", "created_by_id");
CREATE INDEX "subscriptions_created_by_id_idx" ON "subscriptions"("created_by_id");

-- AddForeignKey: subscriptions -> bundles
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_bundle_id_fkey"
    FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: subscriptions -> api_user
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "api_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: bundle_access_tokens -> subscriptions
ALTER TABLE "bundle_access_tokens" ADD CONSTRAINT "bundle_access_tokens_subscription_id_fkey"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: add missing columns to bundles that were added after init
ALTER TABLE "bundles"
    ADD COLUMN IF NOT EXISTS "is_published" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "path" TEXT,
    ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex for bundles.path (unique)
CREATE UNIQUE INDEX IF NOT EXISTS "bundles_path_key" ON "bundles"("path");
