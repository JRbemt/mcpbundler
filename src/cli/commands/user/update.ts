import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface UpdateOptions {
  name?: string;
  contact?: string;
  department?: string;
  token: string;
  host: string;
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  if (!options.name && !options.contact && !options.department) {
    console.error("Error: At least one field (name, contact, or department) must be specified");
    process.exit(1);
  }

  try {
    const client = new BundlerAPIClient(options.host, options.token);
    const result = await client.updateOwnProfile({
      name: options.name,
      contact: options.contact,
      department: options.department
    });

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
