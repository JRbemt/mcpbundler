import { Prisma } from "@prisma/client";
import z from "zod";

export { PrismaClient, BundleAccessToken, GlobalSettings, MCPBundleEntry, BundledMCPCredential, Mcp, Bundle, ApiUser, PermissionType, AuthStrategy, Session } from "@prisma/client";

export type CreatedBundle = Prisma.BundleGetPayload<{
    include: { createdBy: { select: { id: true, name: true } } };
}>;

export type CreatedApiUser = Prisma.ApiUserGetPayload<{
    include: { permissions: true, createdBy: { select: { name: true, id: true } } };
}>;

/**
 * Upstream authentication configuration schema
 *
 * Discriminated union supporting four auth methods: none, bearer, basic,
 * api_keys. Each method has its own required fields.
 */
export const MCPAuthConfigSchema = z.discriminatedUnion('method', [
    z.object({
        method: z.literal('none'),
    }),
    z.object({
        method: z.literal('bearer'),
        token: z.string(),
    }),
    z.object({
        method: z.literal('basic'),
        username: z.string(),
        password: z.string(),
    }),
    z.object({
        method: z.literal('api_key'),
        key: z.string(),
        header: z.string().default('X-API-Key'),
    })
]);
export type MCPAuthConfig = z.infer<typeof MCPAuthConfigSchema>;

/**
 * Per-MCP permissions schema
 *
 * Controls which tools, resources, and prompts clients can access from each MCP.
 * - Use ["*"] for ALL (allow everything)
 * - Use [] for NONE (deny everything)
 * - Use specific names for granular control (e.g., ["read_file", "write_file"])
 */
export const McpPermissionsSchema = z.object({
    allowedTools: z.array(z.string()).default(["*"]),
    allowedResources: z.array(z.string()).default(["*"]),
    allowedPrompts: z.array(z.string()).default(["*"])
});
export type McpPermissions = z.infer<typeof McpPermissionsSchema>;

export type BundleWithMcpsAndCreator = Prisma.BundleGetPayload<{
    include: {
        mcps: {
            include: { mcp: true };
        };
        createdBy: {
            select: { id: true, name: true };
        };
    };
}>;

export type DecryptedBundle = Omit<BundleWithMcpsAndCreator, "mcps"> & {
    mcps: (Omit<BundleWithMcpsAndCreator["mcps"][number], "mcp"> & {
        mcp: BundleWithMcpsAndCreator["mcps"][number]["mcp"] & {
            auth?: MCPAuthConfig;
        };
    })[];
}
