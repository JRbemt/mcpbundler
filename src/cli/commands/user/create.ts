import { BundlerAPIClient } from "../../utils/api-client.js";
import { banner, BG_COLORS } from "../../utils/print-utils.js";

interface CreateOptions {
  name: string;
  contact: string;
  department?: string;
  permissions?: string[];
  admin?: boolean;
  token?: string;
  host: string;
}

export async function createCommand(options: CreateOptions): Promise<void> {
  try {
    const client = new BundlerAPIClient(options.host, options.token);

    if (options.token) {
      const result = await client.createUser({
        name: options.name,
        contact: options.contact,
        department: options.department,
        permissions: options.permissions,
        isAdmin: options.admin || false,
      });

      banner(" User Created Successfully ", { bg: BG_COLORS.GREEN });

      console.group()
      const tableData = [{
        Name: result.name,
        Contact: result.contact,
        Department: result.department || "N/A",
        Admin: result.isAdmin,
        Permissions: result.permissions?.join(", ") || "None",
        Created: new Date(result.createdAt).toLocaleString(),
      }];

      console.table(tableData);
      console.log();
      console.log(`API Key: ${result.apiKey}`);
      console.log("IMPORTANT: Save this API key securely - it will not be shown again!");
      console.groupEnd();
      console.log();
    } else {
      const result = await client.createUserSelfService({
        name: options.name,
        contact: options.contact,
        department: options.department,
      });

      banner("User Created via Self-Service", { bg: BG_COLORS.GREEN });

      const tableData = [{
        Name: result.name,
        Contact: result.contact,
        Department: result.department || "N/A",
        Permissions: result.permissions?.join(", ") || "None",
        Created: new Date(result.createdAt).toLocaleString(),
      }];

      console.table(tableData);

      console.log(`API Key: ${result.apiKey}`);
      console.log("  IMPORTANT: Save this API key securely - it will not be shown again!");
    }
  } catch (error: any) {
    console.error(`Error creating user: ${error.response?.data?.error || error.message}`);
    if (error.response?.data?.message) {
      console.error(`Details: ${error.response.data.message}`);
    }
    process.exit(1);
  }
}
