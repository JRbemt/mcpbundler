import { BundlerAPIClient } from "../../utils/api-client.js";
import { autoTable, banner, BG_COLORS, confirm } from "../../utils/print-utils.js";

interface RevokeCreatedOptions {
  token: string;
  userId?: string;
  all?: boolean;
  host: string;
}

export async function revokeCreatedCommand(options: RevokeCreatedOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);

    if (options.all) {
      const ok = await confirm("Revoke ALL users you created and their descendants? This cannot be undone.");
      if (!ok) {
        console.log("Operation cancelled");
        return;
      }

      const result = await client.revokeAllCreatedUsers();

      banner(" Users Revoked Successfully ", { bg: BG_COLORS.RED });
      console.log(`Users revoked: ${result.total}`);

      if (result.total > 0) {
        autoTable(result.users.map((id, index) => ({
          "#": String(index + 1),
          "User ID": id.userId,
        })));
      }
    } else {
      if (!options.userId) {
        console.error("Error: --user-id is required when not using --all flag");
        process.exit(1);
      }

      const ok = await confirm(`Revoke user ${options.userId} and all users they created?`);
      if (!ok) {
        console.log("Operation cancelled");
        return;
      }

      const result = await client.revokeCreatedUser(options.userId);

      banner(" User Revoked Successfully ", { bg: BG_COLORS.RED });
      console.log(`Users revoked: ${result.total}`);

      if (result.total > 0) {
        autoTable(result.users.map((id, index) => ({
          "#": String(index + 1),
          "User ID": id.userId,
        })));
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
