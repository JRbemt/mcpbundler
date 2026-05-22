-- Remove tokens that were created without a subscription (via the old direct bundle token path).
-- These can no longer be resolved since credential lookup now goes exclusively through subscriptions.
DELETE FROM "bundle_access_tokens" WHERE "subscription_id" IS NULL;

-- Make subscription_id non-nullable
ALTER TABLE "bundle_access_tokens" ALTER COLUMN "subscription_id" SET NOT NULL;

-- Replace the SET NULL foreign key with CASCADE so deleting a subscription revokes its tokens
ALTER TABLE "bundle_access_tokens" DROP CONSTRAINT IF EXISTS "bundle_access_tokens_subscription_id_fkey";
ALTER TABLE "bundle_access_tokens"
  ADD CONSTRAINT "bundle_access_tokens_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
