import { BundlerAPIClient } from "../../utils/api-client.js";
import { autoTable } from "../../utils/print-utils.js";

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
      console.log("No users found.");
      return;
    }

    console.log(`Found ${users.length} user(s):`);
    autoTable(users.map(user => ({
      Name: user.name,
      Contact: user.contact,
      Department: user.department || "N/A",
      Admin: String(user.isAdmin),
      Created: new Date(user.createdAt).toLocaleString(),
      "Last Used": user.lastUsedAt ? new Date(user.lastUsedAt).toLocaleString() : "N/A",
      Revoked: user.revokedAt ? new Date(user.revokedAt).toLocaleString() : "N/A",
      "Created By": user.createdById || "N/A",
    })));
    console.log();

  } catch (error: any) {
    console.error(`Error listing users: ${error}`);
    process.exit(1);
  }
}
