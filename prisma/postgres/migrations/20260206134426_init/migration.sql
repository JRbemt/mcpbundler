-- CreateEnum
CREATE TYPE "AuthStrategy" AS ENUM ('MASTER', 'USER_SET', 'NONE');

-- CreateEnum
CREATE TYPE "PermissionType" AS ENUM ('CREATE_USER', 'ADD_MCP', 'LIST_USERS', 'VIEW_PERMISSIONS');

-- CreateTable
CREATE TABLE "bundles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,

    CONSTRAINT "bundles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcps" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "stateless" BOOLEAN NOT NULL DEFAULT false,
    "auth_strategy" "AuthStrategy" NOT NULL DEFAULT 'NONE',
    "master_auth_config" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" TEXT,

    CONSTRAINT "mcps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_bundle_entry" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "mcp_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allowed_tools" TEXT NOT NULL DEFAULT '["*"]',
    "allowed_resources" TEXT NOT NULL DEFAULT '["*"]',
    "allowed_prompts" TEXT NOT NULL DEFAULT '["*"]',

    CONSTRAINT "mcp_bundle_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_access_tokens" (
    "id" TEXT NOT NULL,
    "bundle_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,

    CONSTRAINT "bundle_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_token_mcp_credential" (
    "id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "mcp_id" TEXT NOT NULL,
    "auth_config" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bundle_token_mcp_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "contact" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "is_admin" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" TEXT,

    CONSTRAINT "api_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_user_permission" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "permission_type" "PermissionType" NOT NULL,

    CONSTRAINT "api_user_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "global_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "allow_self_service_registration" BOOLEAN NOT NULL DEFAULT false,
    "default_self_service_permissions" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "global_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bundles_created_by_id_idx" ON "bundles"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "bundles_name_created_by_id_key" ON "bundles"("name", "created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcps_namespace_key" ON "mcps"("namespace");

-- CreateIndex
CREATE INDEX "mcps_created_by_id_idx" ON "mcps"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_bundle_entry_bundle_id_mcp_id_key" ON "mcp_bundle_entry"("bundle_id", "mcp_id");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_access_tokens_token_hash_key" ON "bundle_access_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_token_mcp_credential_token_id_mcp_id_key" ON "bundle_token_mcp_credential"("token_id", "mcp_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_user_key_hash_key" ON "api_user"("key_hash");

-- CreateIndex
CREATE INDEX "api_user_is_admin_idx" ON "api_user"("is_admin");

-- CreateIndex
CREATE INDEX "api_user_revoked_at_idx" ON "api_user"("revoked_at");

-- CreateIndex
CREATE INDEX "api_user_created_by_id_idx" ON "api_user"("created_by_id");

-- CreateIndex
CREATE INDEX "api_user_last_used_at_idx" ON "api_user"("last_used_at");

-- CreateIndex
CREATE INDEX "api_user_permission_permission_type_idx" ON "api_user_permission"("permission_type");

-- CreateIndex
CREATE UNIQUE INDEX "api_user_permission_user_id_permission_type_key" ON "api_user_permission"("user_id", "permission_type");

-- AddForeignKey
ALTER TABLE "bundles" ADD CONSTRAINT "bundles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "api_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcps" ADD CONSTRAINT "mcps_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "api_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_bundle_entry" ADD CONSTRAINT "mcp_bundle_entry_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_bundle_entry" ADD CONSTRAINT "mcp_bundle_entry_mcp_id_fkey" FOREIGN KEY ("mcp_id") REFERENCES "mcps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_access_tokens" ADD CONSTRAINT "bundle_access_tokens_bundle_id_fkey" FOREIGN KEY ("bundle_id") REFERENCES "bundles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_access_tokens" ADD CONSTRAINT "bundle_access_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "api_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_token_mcp_credential" ADD CONSTRAINT "bundle_token_mcp_credential_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "bundle_access_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_token_mcp_credential" ADD CONSTRAINT "bundle_token_mcp_credential_mcp_id_fkey" FOREIGN KEY ("mcp_id") REFERENCES "mcps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_user" ADD CONSTRAINT "api_user_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "api_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_user_permission" ADD CONSTRAINT "api_user_permission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "api_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
