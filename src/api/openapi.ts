import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { readFileSync } from "fs";
import { join } from "path";
const { version } = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8")) as { version: string };
import { CreateMcpRequestSchema, UpdateMcpRequestSchema, MCPResponseSchema, BulkDeleteResponseSchema } from "./routes/utils/mcp-schemas.js";
import {
  CreateBundleRequestSchema,
  UpdateBundleRequestSchema,
  GenerateTokenRequestSchema,
  AddMcpsByNamespaceRequestSchema,
  BundleResponseSchema,
  CreateBundleResponseSchema,
  ListTokenResponseSchema,
  GenerateTokenResponseSchema,
  AddMcpByNamespaceResponseSchema,
} from "./routes/utils/bundle-schemas.js";
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  UserResponseSchema,
  UserResponseWithCreatedUsersSchema,
  CreateUserResponseSchema,
  BaseUserSchema,
  DeleteUserResponseSchema,
  DeleteAllUsersResponseSchema,
} from "./routes/utils/user-schemas.js";
import {
  AddPermissionRequestSchema,
  RemovePermissionRequestSchema,
  PermissionListResponseSchema,
  UserPermissionsResponseSchema,
  ChangePermissionResponseSchema,
} from "./routes/utils/permission-schemas.js";
import { ErrorResponseSchema } from "./routes/utils/error-schemas.js";
import {
  UpsertSubscriptionRequestSchema,
  SubscriptionResponseSchema,
  GenerateSubscriptionTokenRequestSchema,
  GenerateSubscriptionTokenResponseSchema,
} from "./routes/subscriptions.js";
import { LlmProviderResponseSchema, LlmBindingResponseSchema, UpsertLlmBindingSchema } from "./routes/llm-providers.js";

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.registerComponent("securitySchemes", "apiKey", {
  type: "http",
  scheme: "bearer",
  description: "Admin API key (format: mbk_...)",
});

const auth = [{ apiKey: [] }];
const idParam = z.object({ id: z.string().openapi({ example: "clxyz123" }) });
const namespaceParam = z.object({ namespace: z.string().openapi({ example: "my-mcp-server" }) });
const err404 = { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } };
const err403 = { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } };
const noContent = { description: "No content" };

// MCPs
registry.registerPath({
  method: "get",
  path: "/mcps",
  tags: ["MCPs"],
  summary: "List all MCP servers",
  security: auth,
  responses: {
    200: { description: "MCP list", content: { "application/json": { schema: MCPResponseSchema.array() } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/mcps",
  tags: ["MCPs"],
  summary: "Register a new MCP server",
  security: auth,
  request: { body: { required: true, content: { "application/json": { schema: CreateMcpRequestSchema } } } },
  responses: {
    201: { description: "MCP created", content: { "application/json": { schema: MCPResponseSchema } } },
    403: err403,
    409: { description: "Namespace already exists", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/mcps/{namespace}",
  tags: ["MCPs"],
  summary: "Get MCP by namespace",
  security: auth,
  request: { params: namespaceParam },
  responses: {
    200: { description: "MCP record", content: { "application/json": { schema: MCPResponseSchema } } },
    404: err404,
  },
});

registry.registerPath({
  method: "put",
  path: "/mcps/{namespace}",
  tags: ["MCPs"],
  summary: "Update MCP by namespace",
  security: auth,
  request: {
    params: namespaceParam,
    body: { required: true, content: { "application/json": { schema: UpdateMcpRequestSchema } } },
  },
  responses: {
    200: { description: "Updated MCP", content: { "application/json": { schema: MCPResponseSchema } } },
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: "delete",
  path: "/mcps/all",
  tags: ["MCPs"],
  summary: "Bulk delete all MCPs created by the caller and their descendants",
  security: auth,
  responses: {
    200: { description: "Deletion summary", content: { "application/json": { schema: BulkDeleteResponseSchema } } },
  },
});

registry.registerPath({
  method: "delete",
  path: "/mcps/{namespace}",
  tags: ["MCPs"],
  summary: "Delete MCP by namespace",
  security: auth,
  request: { params: namespaceParam },
  responses: {
    204: noContent,
    403: err403,
    404: err404,
  },
});

// Bundles
registry.registerPath({
  method: "get",
  path: "/bundles",
  tags: ["Bundles"],
  summary: "List all bundles",
  security: auth,
  responses: {
    200: { description: "Bundle list", content: { "application/json": { schema: BundleResponseSchema.array() } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/bundles/me",
  tags: ["Bundles"],
  summary: "List bundles created by the caller or their descendants",
  security: auth,
  responses: {
    200: { description: "Bundle list", content: { "application/json": { schema: BundleResponseSchema.array() } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/bundles",
  tags: ["Bundles"],
  summary: "Create a bundle",
  security: auth,
  request: { body: { required: true, content: { "application/json": { schema: CreateBundleRequestSchema } } } },
  responses: {
    201: { description: "Bundle created", content: { "application/json": { schema: CreateBundleResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/bundles/{id}",
  tags: ["Bundles"],
  summary: "Get bundle with its MCPs",
  security: auth,
  request: { params: idParam },
  responses: {
    200: { description: "Bundle", content: { "application/json": { schema: BundleResponseSchema } } },
    404: err404,
  },
});

registry.registerPath({
  method: "patch",
  path: "/bundles/{id}",
  tags: ["Bundles"],
  summary: "Update bundle metadata",
  security: auth,
  request: {
    params: idParam,
    body: { required: true, content: { "application/json": { schema: UpdateBundleRequestSchema } } },
  },
  responses: {
    200: { description: "Updated bundle", content: { "application/json": { schema: CreateBundleResponseSchema } } },
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: "delete",
  path: "/bundles/{id}",
  tags: ["Bundles"],
  summary: "Delete a bundle and its tokens",
  security: auth,
  request: { params: idParam },
  responses: {
    204: noContent,
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: "post",
  path: "/bundles/{id}",
  tags: ["Bundles"],
  summary: "Add one or more MCPs to a bundle by namespace",
  security: auth,
  request: {
    params: idParam,
    body: { required: true, content: { "application/json": { schema: AddMcpsByNamespaceRequestSchema } } },
  },
  responses: {
    207: { description: "Result with added MCPs and any errors", content: { "application/json": { schema: AddMcpByNamespaceResponseSchema } } },
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: "delete",
  path: "/bundles/{id}/{namespace}",
  tags: ["Bundles"],
  summary: "Remove an MCP from a bundle",
  security: auth,
  request: { params: z.object({ id: z.string(), namespace: z.string() }) },
  responses: {
    204: noContent,
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: "post",
  path: "/bundles/{id}/tokens",
  tags: ["Bundles"],
  summary: "Generate an access token for a bundle",
  security: auth,
  request: {
    params: idParam,
    body: { required: true, content: { "application/json": { schema: GenerateTokenRequestSchema } } },
  },
  responses: {
    201: { description: "Generated token (shown once)", content: { "application/json": { schema: GenerateTokenResponseSchema } } },
    404: err404,
  },
});

registry.registerPath({
  method: "get",
  path: "/bundles/{id}/tokens",
  tags: ["Bundles"],
  summary: "List tokens for a bundle",
  security: auth,
  request: { params: idParam },
  responses: {
    200: { description: "Token list", content: { "application/json": { schema: ListTokenResponseSchema } } },
    404: err404,
  },
});

registry.registerPath({
  method: "delete",
  path: "/bundles/{id}/tokens/{tokenId}",
  tags: ["Bundles"],
  summary: "Revoke a bundle token",
  security: auth,
  request: { params: z.object({ id: z.string(), tokenId: z.string() }) },
  responses: {
    204: noContent,
    403: err403,
    404: err404,
  },
});

// Users
registry.registerPath({
  method: "post",
  path: "/users/self",
  tags: ["Users"],
  summary: "Self-service registration (no auth required, must be enabled by admin)",
  request: { body: { required: true, content: { "application/json": { schema: CreateUserRequestSchema } } } },
  responses: {
    201: { description: "User created with API key (shown once)", content: { "application/json": { schema: CreateUserResponseSchema } } },
    403: { description: "Self-service registration is disabled", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/users",
  tags: ["Users"],
  summary: "Create a user (requires CREATE_USER permission)",
  security: auth,
  request: { body: { required: true, content: { "application/json": { schema: CreateUserRequestSchema } } } },
  responses: {
    201: { description: "User created with API key (shown once)", content: { "application/json": { schema: CreateUserResponseSchema } } },
    403: err403,
  },
});

registry.registerPath({
  method: "get",
  path: "/users",
  tags: ["Users"],
  summary: "List all users (requires LIST_USERS permission)",
  security: auth,
  request: {
    query: z.object({ include_revoked: z.enum(["true", "false"]).optional().openapi({ description: "Include revoked users" }) }),
  },
  responses: {
    200: { description: "User list", content: { "application/json": { schema: UserResponseSchema.array() } } },
    403: err403,
  },
});

registry.registerPath({
  method: "get",
  path: "/users/me",
  tags: ["Users"],
  summary: "Get own profile with created users",
  security: auth,
  responses: {
    200: { description: "Own profile", content: { "application/json": { schema: UserResponseWithCreatedUsersSchema } } },
  },
});

registry.registerPath({
  method: "put",
  path: "/users/me",
  tags: ["Users"],
  summary: "Update own profile",
  security: auth,
  request: { body: { required: true, content: { "application/json": { schema: UpdateUserRequestSchema } } } },
  responses: {
    200: { description: "Updated profile", content: { "application/json": { schema: BaseUserSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/users/me/revoke",
  tags: ["Users"],
  summary: "Revoke own API key",
  security: auth,
  responses: {
    200: { description: "Revoked user ID", content: { "application/json": { schema: DeleteUserResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/users/{userId}/revoke",
  tags: ["Users"],
  summary: "Revoke a user you created (cascades to their descendants)",
  security: auth,
  request: { params: z.object({ userId: z.string() }) },
  responses: {
    200: { description: "Revoked users", content: { "application/json": { schema: DeleteAllUsersResponseSchema } } },
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: "get",
  path: "/users/by-name/{name}",
  tags: ["Users"],
  summary: "Get user by name (admin only)",
  security: auth,
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: { description: "User record", content: { "application/json": { schema: UserResponseSchema } } },
    403: err403,
    404: err404,
  },
});

// Permissions
registry.registerPath({
  method: "get",
  path: "/permissions",
  tags: ["Permissions"],
  summary: "List all available permission types (no auth required)",
  responses: {
    200: { description: "Permission types with descriptions", content: { "application/json": { schema: PermissionListResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/permissions/me",
  tags: ["Permissions"],
  summary: "Get own permissions",
  security: auth,
  responses: {
    200: { description: "Caller permissions", content: { "application/json": { schema: UserPermissionsResponseSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/permissions/user-id/{id}",
  tags: ["Permissions"],
  summary: "Get permissions for a specific user (requires VIEW_PERMISSIONS)",
  security: auth,
  request: { params: idParam },
  responses: {
    200: { description: "User permissions", content: { "application/json": { schema: UserPermissionsResponseSchema } } },
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: "post",
  path: "/permissions/user-id/{id}/add",
  tags: ["Permissions"],
  summary: "Add permissions to a user (optionally cascade to their descendants)",
  security: auth,
  request: {
    params: idParam,
    body: { required: true, content: { "application/json": { schema: AddPermissionRequestSchema } } },
  },
  responses: {
    201: { description: "Updated permissions", content: { "application/json": { schema: ChangePermissionResponseSchema } } },
    403: err403,
    404: err404,
  },
});

registry.registerPath({
  method: "post",
  path: "/permissions/user-id/{id}/remove",
  tags: ["Permissions"],
  summary: "Remove permissions from a user (cascades to descendants)",
  security: auth,
  request: {
    params: idParam,
    body: { required: true, content: { "application/json": { schema: RemovePermissionRequestSchema } } },
  },
  responses: {
    200: { description: "Updated permissions", content: { "application/json": { schema: ChangePermissionResponseSchema } } },
    403: err403,
    404: err404,
  },
});

// Subscriptions
registry.registerPath({
  method: "post",
  path: "/subscriptions",
  tags: ["Subscriptions"],
  summary: "Upsert a named subscription linking a user to a bundle with credentials",
  security: auth,
  request: { body: { required: true, content: { "application/json": { schema: UpsertSubscriptionRequestSchema } } } },
  responses: {
    201: { description: "Subscription", content: { "application/json": { schema: SubscriptionResponseSchema } } },
    404: err404,
  },
});

registry.registerPath({
  method: "get",
  path: "/subscriptions",
  tags: ["Subscriptions"],
  summary: "List subscriptions owned by the caller",
  security: auth,
  responses: {
    200: { description: "Subscription list", content: { "application/json": { schema: SubscriptionResponseSchema.array() } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/subscriptions/{name}",
  tags: ["Subscriptions"],
  summary: "Get a subscription by name",
  security: auth,
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: { description: "Subscription", content: { "application/json": { schema: SubscriptionResponseSchema } } },
    404: err404,
  },
});

registry.registerPath({
  method: "delete",
  path: "/subscriptions/{name}",
  tags: ["Subscriptions"],
  summary: "Delete a subscription and cascade to its tokens",
  security: auth,
  request: { params: z.object({ name: z.string() }) },
  responses: {
    204: noContent,
    404: err404,
  },
});

registry.registerPath({
  method: "post",
  path: "/subscriptions/{name}/token",
  tags: ["Subscriptions"],
  summary: "Generate an access token bound to a subscription (inherits its credentials)",
  security: auth,
  request: {
    params: z.object({ name: z.string() }),
    body: { required: true, content: { "application/json": { schema: GenerateSubscriptionTokenRequestSchema } } },
  },
  responses: {
    201: { description: "Generated token", content: { "application/json": { schema: GenerateSubscriptionTokenResponseSchema } } },
    404: err404,
  },
});

// LLM Providers
registry.registerPath({
  method: "get",
  path: "/llm-providers",
  tags: ["LLM"],
  summary: "List all registered LLM providers",
  security: auth,
  responses: {
    200: { description: "Provider list", content: { "application/json": { schema: LlmProviderResponseSchema.array() } } },
  },
});

registry.registerPath({
  method: "put",
  path: "/llm-bindings/{provider}",
  tags: ["LLM"],
  summary: "Bind an API key to an LLM provider for the caller",
  security: auth,
  request: {
    params: z.object({ provider: z.string().openapi({ example: "claude" }) }),
    body: { required: true, content: { "application/json": { schema: UpsertLlmBindingSchema } } },
  },
  responses: {
    200: { description: "Binding result", content: { "application/json": { schema: LlmBindingResponseSchema } } },
    404: err404,
  },
});

registry.registerPath({
  method: "delete",
  path: "/llm-bindings/{provider}",
  tags: ["LLM"],
  summary: "Remove an LLM API key binding for the caller",
  security: auth,
  request: { params: z.object({ provider: z.string().openapi({ example: "claude" }) }) },
  responses: {
    200: { description: "Binding result", content: { "application/json": { schema: LlmBindingResponseSchema } } },
    404: err404,
  },
});

export function generateOpenApiSpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "MCP Bundler Management API",
      version,
      description: "Management API for the MCP Bundler. Requires a Bearer admin API key (format: mbk_...) on all endpoints except GET /permissions and POST /users/self.",
    },
    servers: [{ url: "/api" }],
  });
}
