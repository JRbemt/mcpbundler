/*
  Warnings:

  - You are about to drop the `collection_permissions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `auth_config` on the `collection_mcps` table. All the data in the column will be lost.
  - You are about to drop the column `collection_mcp_id` on the `oauth_credentials` table. All the data in the column will be lost.
  - Added the required column `name` to the `collection_tokens` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "mcps" ADD COLUMN "master_auth_config" TEXT;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "collection_permissions";
PRAGMA foreign_keys=on;

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

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_collection_mcps" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_id" TEXT NOT NULL,
    "mcp_id" TEXT NOT NULL,
    "auth_strategy" TEXT NOT NULL DEFAULT 'MASTER',
    "added_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allowed_tools" TEXT NOT NULL DEFAULT '["*"]',
    "allowed_resources" TEXT NOT NULL DEFAULT '["*"]',
    "allowed_prompts" TEXT NOT NULL DEFAULT '["*"]',
    CONSTRAINT "collection_mcps_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collection_mcps_mcp_id_fkey" FOREIGN KEY ("mcp_id") REFERENCES "mcps" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_collection_mcps" ("added_at", "collection_id", "id", "mcp_id") SELECT "added_at", "collection_id", "id", "mcp_id" FROM "collection_mcps";
DROP TABLE "collection_mcps";
ALTER TABLE "new_collection_mcps" RENAME TO "collection_mcps";
CREATE UNIQUE INDEX "collection_mcps_collection_id_mcp_id_key" ON "collection_mcps"("collection_id", "mcp_id");
CREATE TABLE "new_collection_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collection_tokens_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_collection_tokens" ("collection_id", "created_at", "expires_at", "id", "revoked", "token_hash") SELECT "collection_id", "created_at", "expires_at", "id", "revoked", "token_hash" FROM "collection_tokens";
DROP TABLE "collection_tokens";
ALTER TABLE "new_collection_tokens" RENAME TO "collection_tokens";
CREATE UNIQUE INDEX "collection_tokens_token_hash_key" ON "collection_tokens"("token_hash");
CREATE TABLE "new_oauth_credentials" (
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
INSERT INTO "new_oauth_credentials" ("access_token", "created_at", "expires_at", "id", "provider", "refresh_token", "updated_at") SELECT "access_token", "created_at", "expires_at", "id", "provider", "refresh_token", "updated_at" FROM "oauth_credentials";
DROP TABLE "oauth_credentials";
ALTER TABLE "new_oauth_credentials" RENAME TO "oauth_credentials";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "collection_token_mcp_credentials_token_id_mcp_id_key" ON "collection_token_mcp_credentials"("token_id", "mcp_id");
