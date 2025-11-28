import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface UpdateOptions {
  token: string;
  name?: string;
  contact?: string;
  department?: string;
  host: string;
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  if (!options.name && !options.contact && !options.department) {
    console.error("Error: At least one field (name, contact, or department) must be specified");
    process.exit(1);
  }

  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const updates: any = {};
    if (options.name) updates.name = options.name;
    if (options.contact) updates.contact = options.contact;
    if (options.department) updates.department = options.department;

    const result = await client.updateOwnProfile(updates);

    banner("Profile Updated Successfully", { bg: BG_COLORS.GREEN });

    const tableData = [{
      Name: result.name,
      Contact: result.contact,
      Department: result.department || "N/A",
    }];

    console.table(tableData);
  } catch (error: any) {
    console.error(`Error updating profile: ${error.response?.data?.error || error.message}`);
    process.exit(1);
  }
}
