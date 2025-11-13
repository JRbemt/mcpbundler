-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "collection_permissions" (
    "collection_id" TEXT NOT NULL PRIMARY KEY,
    "can_call_tools" BOOLEAN NOT NULL DEFAULT false,
    "can_read_resources" BOOLEAN NOT NULL DEFAULT false,
    "can_use_prompts" BOOLEAN NOT NULL DEFAULT false,
    "can_manage_collection" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "collection_permissions_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "collection_mcps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_id" TEXT NOT NULL,
    "mcp_id" TEXT NOT NULL,
    "auth_config" JSONB,
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collection_mcps_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collection_mcps_mcp_id_fkey" FOREIGN KEY ("mcp_id") REFERENCES "mcps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_mcp_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "oauth_credentials_collection_mcp_id_fkey" FOREIGN KEY ("collection_mcp_id") REFERENCES "collection_mcps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "collection_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collection_tokens_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "mcps_namespace_key" ON "mcps"("namespace");

-- CreateIndex
CREATE UNIQUE INDEX "collection_mcps_collection_id_mcp_id_key" ON "collection_mcps"("collection_id", "mcp_id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_tokens_token_hash_key" ON "collection_tokens"("token_hash");
