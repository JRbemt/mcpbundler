import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface RevokeCreatedOptions {
  token: string;
  userId?: string;
  all?: boolean;
  host: string;
}

export async function revokeCreatedCommand(options: RevokeCreatedOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);

    // Handle --all flag
    if (options.all) {
      console.log(`\n⚠️  WARNING: This will revoke ALL users you created and all their descendants!`);
      console.log(`⚠️  This action cannot be undone!\n`);

      const result = await client.revokeAllCreatedUsers();

      banner("Users Revoked Successfully", { bg: BG_COLORS.RED });

      console.log(`\n  Direct users revoked: ${result.direct_users_revoked}`);
      console.log(`  Total users revoked (including descendants): ${result.total_revoked}\n`);

      if (result.total_revoked > 0) {
        const tableData = result.revoked_user_ids.map((id, index) => ({
          "#": index + 1,
          "User ID": id
        }));
        console.table(tableData);
      }
    } else {
      // Handle single user revocation
      if (!options.userId) {
        console.error("Error: --user-id is required when not using --all flag");
        process.exit(1);
      }

      const result = await client.revokeCreatedUser(options.userId);

      banner("User Revoked Successfully", { bg: BG_COLORS.RED });

      console.log(`\n  Total users revoked (including descendants): ${result.total_revoked}\n`);

      if (result.total_revoked > 0) {
        const tableData = result.revoked_user_ids.map((id, index) => ({
          "#": index + 1,
          "User ID": id
        }));
        console.table(tableData);
      }
    }
  } catch (error: any) {
    console.error(`Error revoking user(s): ${error.response?.data?.error || error.message}`);
    if (error.response?.data?.message) {
      console.error(`Details: ${error.response.data.message}`);
    }
    process.exit(1);
  }
}
