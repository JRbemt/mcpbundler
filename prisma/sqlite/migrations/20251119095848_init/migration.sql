-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_collections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "created_by_id" TEXT,
    CONSTRAINT "collections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "api_user" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_collections" ("created_at", "id", "name", "updated_at") SELECT "created_at", "id", "name", "updated_at" FROM "collections";
DROP TABLE "collections";
ALTER TABLE "new_collections" RENAME TO "collections";
CREATE INDEX "collections_created_by_id_idx" ON "collections"("created_by_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
