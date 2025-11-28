-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "mcps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "namespace" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "stateless" BOOLEAN NOT NULL DEFAULT false,
    "token_cost" REAL NOT NULL DEFAULT 0.001,
    "auth_strategy" TEXT NOT NULL DEFAULT 'NONE',
    "master_auth_config" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "collection_mcps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_id" TEXT NOT NULL,
    "mcp_id" TEXT NOT NULL,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allowed_tools" TEXT NOT NULL DEFAULT '["*"]',
    "allowed_resources" TEXT NOT NULL DEFAULT '["*"]',
    "allowed_prompts" TEXT NOT NULL DEFAULT '["*"]',
    CONSTRAINT "collection_mcps_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collection_mcps_mcp_id_fkey" FOREIGN KEY ("mcp_id") REFERENCES "mcps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token_mcp_credential_id" TEXT,
    "token_id" TEXT,
    "provider" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "oauth_credentials_token_mcp_credential_id_fkey" FOREIGN KEY ("token_mcp_credential_id") REFERENCES "collection_token_mcp_credentials" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_credentials_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "collection_tokens" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "collection_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME,
    CONSTRAINT "collection_tokens_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "collection_token_mcp_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token_id" TEXT NOT NULL,
    "mcp_id" TEXT NOT NULL,
    "auth_config" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "collection_token_mcp_credentials_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "collection_tokens" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collection_token_mcp_credentials_mcp_id_fkey" FOREIGN KEY ("mcp_id") REFERENCES "mcps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "api_user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "contact" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" DATETIME,
    "revoked_at" DATETIME,
    "is_admin" BOOLEAN NOT NULL,
    "created_by_id" TEXT,
    CONSTRAINT "api_user_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "api_user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "api_user_permission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "permission_type" TEXT NOT NULL,
    CONSTRAINT "api_user_permission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "api_user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "global_settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'global',
    "allow_self_service_registration" BOOLEAN NOT NULL DEFAULT false,
    "default_self_service_permissions" TEXT NOT NULL DEFAULT '[]'
);

-- CreateIndex
CREATE UNIQUE INDEX "mcps_namespace_key" ON "mcps"("namespace");

-- CreateIndex
CREATE UNIQUE INDEX "collection_mcps_collection_id_mcp_id_key" ON "collection_mcps"("collection_id", "mcp_id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_tokens_token_hash_key" ON "collection_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "collection_token_mcp_credentials_token_id_mcp_id_key" ON "collection_token_mcp_credentials"("token_id", "mcp_id");

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
