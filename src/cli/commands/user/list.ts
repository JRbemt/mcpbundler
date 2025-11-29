import { BundlerAPIClient } from "../../utils/api-client.js";

interface ListOptions {
  token: string;
  includeRevoked?: boolean;
  host: string;
}

export async function listCommand(options: ListOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const users = await client.listUsers(options.includeRevoked);

    if (users.length === 0) {
      console.log("\nNo users found.");
      return;
    }
    // Prepare a table-friendly array
    const tableData = users.map(user => ({
      Name: user.name,
      Contact: user.contact,
      Department: user.department || "N/A",
      Admin: user.is_admin,
      Created: new Date(user.created_at).toLocaleString(),
      "Last Used": user.last_used_at ? new Date(user.last_used_at).toLocaleString() : "N/A",
      Revoked: user.revoked_at ? new Date(user.revoked_at).toLocaleString() : "N/A",
      "Created By": user.created_by || "N/A",
    }));

    console.log(`\nFound ${users.length} user(s):\n`);
    console.table(tableData);
    console.log()

  } catch (error: any) {
    console.error(`Error listing users: ${error}`);
    process.exit(1);
  }
}
