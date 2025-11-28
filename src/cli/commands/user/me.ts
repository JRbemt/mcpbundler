import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface MeOptions {
  token: string;
  host: string;
}

export async function meCommand(options: MeOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const profile = await client.getOwnProfile();

    banner(" Profile ", { bg: BG_COLORS.GREEN });
    console.group()
    console.log(`- Name: ${profile.name}`);
    console.log(`- Contact: ${profile.contact}`);
    console.log(`- Department: ${profile.department || "N/A"}`);
    console.log(`- Admin: ${profile.is_admin}`);
    console.log(`- Permissions: ${profile.permissions.join(", ") || "None"}`);
    console.log(`- Created: ${new Date(profile.created_at).toLocaleString()}`);
    if (profile.last_used_at) {
      console.log(`- Last Used: ${new Date(profile.last_used_at).toLocaleString()}`);
    }
    console.groupEnd()

    console.log()
    banner(" Users Created ", { bg: BG_COLORS.GREEN });
    console.group()
    // Display created users if any
    if (profile.created_users && profile.created_users.length > 0) {

      const tableData = profile.created_users.map(user => ({
        ID: user.id,
        Name: user.name,
        Contact: user.contact,
        Department: user.department || "N/A",
        Admin: user.is_admin,
        Permissions: user.permissions.join(", ") || "None",
        Created: new Date(user.created_at).toLocaleString(),
        "Last Used": user.last_used_at ? new Date(user.last_used_at).toLocaleString() : "Never",
        Revoked: user.revoked_at ? "Yes" : "No",
      }));

      console.table(tableData);

    } else {
      console.log("(You have not created any users yet: mcpbundler user create)");
    }
    console.groupEnd()
  } catch (error: any) {
    console.error(`Error fetching profile: ${error.response?.data?.error || error.message}`);
    process.exit(1);
  }
}
