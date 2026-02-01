import axios, { AxiosInstance } from "axios";
import type {
  CreateBundleRequest,
  CreateBundleResponse,
  GenerateTokenRequest,
  GenerateTokenResponse,
  AddMcpsByNamespaceRequest,
  AddMcpByNamespaceResponse,
  BundleResponse,
} from "../../api/routes/bundles.js";
import type {
  CredentialResponse,
  CredentialListItem,
} from "../../api/routes/credentials.js";
import type {
  CreateMcpRequest,
  McpResponse,
} from "../../api/routes/mcps.js";
import type {
  UserResponse,
  CreateUserResponse,
  UserResponseWithCreatedUsers,
  DeleteUserResponse,
  DeleteAllUsersResponse,
} from "../../api/routes/users.js";
import type {
  PermissionListResponse,
  UserPermissionsResponse,
  ChangePermissionResponse,
} from "../../api/routes/permissions.js";
import { MCPAuthConfig } from "../../shared/domain/entities.js";

// Re-exported types from API routes
export type Mcp = McpResponse;
export type ApiUser = UserResponse;
export type ApiUserWithCreatedUsers = UserResponseWithCreatedUsers;
export type Token = GenerateTokenResponse;
export type PermissionTypes = PermissionListResponse;

// MCP (used in CLI commands)
// Re-export bundle API types for CLI use
export { CreateBundleRequest, CreateBundleResponse, GenerateTokenRequest, GenerateTokenResponse };
export type AddMcpRequest = AddMcpsByNamespaceRequest;
export type AddMcpResponse = AddMcpByNamespaceResponse;
export { AddMcpsByNamespaceRequest };

// Re-export credential API types for CLI use
export type Credential = CredentialListItem;
export { CredentialResponse };

export class BundlerAPIClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(portOrUrl: string, token?: string) {
    // Support both port number (localhost) and full URL (remote)
    this.baseUrl = portOrUrl;

    console.log(`Creating client with: ${{ portOrUrl, token }}`)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add auth token for remote servers
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers,
    });
  }

  /**
   * Check if daemon is reachable
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.get("/metrics");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get server metrics
   */
  async getMetrics(): Promise<any> {
    const response = await this.client.get("/metrics");
    return response.data;
  }

  /**
   * List all bundles
   */
  async listBundles(): Promise<BundleResponse[]> {
    const response = await this.client.get("/api/bundles");
    return response.data;
  }

  /**
   * List bundles created by the authenticated user
   */
  async listMyBundles(): Promise<BundleResponse[]> {
    const response = await this.client.get("/api/bundles/me");
    return response.data;
  }

  /**
   * Get a specific bundle
   */
  async getBundle(bundleId: string): Promise<BundleResponse> {
    const response = await this.client.get(`/api/bundles/${bundleId}`);
    return response.data;
  }

  /**
   * Create a new bundle
   */
  async createBundle(name: string, description: string): Promise<BundleResponse> {
    const response = await this.client.post("/api/bundles", { name, description });
    return response.data;
  }

  /**
   * Delete a bundle by ID
   */
  async deleteBundle(bundleId: string): Promise<void> {
    await this.client.delete(`/api/bundles/${bundleId}`);
  }

  /**
   * Add MCP(s) to a bundle by namespace
   */
  async addMcpToBundle(bundleId: string, mcpRequests: AddMcpRequest): Promise<AddMcpResponse> {
    const response = await this.client.post(`/api/bundles/${bundleId}`, mcpRequests);
    return response.data;
  }

  /**
   * Delete MCP from a bundle
   */
  async deleteMcpFromBundle(bundleId: string, namespace: string): Promise<void> {
    await this.client.delete(`/api/bundles/${bundleId}/${namespace}`);
  }

  /**
   * Generate access token for a bundle
   */
  async generateToken(
    bundleId: string,
    name: string,
    description?: string,
    expiresAt?: string
  ): Promise<GenerateTokenResponse> {
    const response = await this.client.post(`/api/bundles/${bundleId}/tokens`, {
      name,
      description,
      expiresAt,
    });
    return response.data;
  }

  /**
   * List all tokens for a bundle
   */
  async listBundleTokens(bundleId: string): Promise<Token[]> {
    const response = await this.client.get(`/api/bundles/${bundleId}/tokens`);
    return response.data;
  }

  /**
   * Revoke/delete a bundle token
   */
  async revokeBundleToken(bundleId: string, tokenId: string): Promise<void> {
    await this.client.delete(`/api/bundles/${bundleId}/tokens/${tokenId}`);
  }

  /**
   * List all master MCPs
   */
  async listMcps(): Promise<Mcp[]> {
    const response = await this.client.get("/api/mcps");
    return response.data;
  }

  /**
   * Create a master MCP
   */
  async createMcp(config: CreateMcpRequest): Promise<McpResponse> {
    const response = await this.client.post("/api/mcps", config);
    return response.data;
  }

  /**
   * Get MCP by namespace
   */
  async getMcpByNamespace(namespace: string): Promise<Mcp> {
    const response = await this.client.get(`/api/mcps/${namespace}`);
    return response.data;
  }

  /**
   * Update MCP by namespace
   */
  async updateMcp(namespace: string, config: Partial<McpResponse>): Promise<Mcp> {
    const response = await this.client.put(`/api/mcps/${namespace}`, config);
    return response.data;
  }

  /**
   * Delete MCP by namespace
   */
  async deleteMcp(namespace: string): Promise<void> {
    await this.client.delete(`/api/mcps/${namespace}`);
  }

  /**
   * Delete all MCPs created by the current user
   */
  async deleteAllMyMcps(): Promise<{ deleted: number; mcps: string[] }> {
    const response = await this.client.delete("/api/mcps");
    return response.data;
  }

  /**
   * Create user via self-service (no authentication)
   */
  async createUserSelfService(data: {
    name: string;
    contact: string;
    department?: string;
  }): Promise<CreateUserResponse> {
    const response = await this.client.post("/api/users/self", data);
    return response.data;
  }

  /**
   * Create a new user (requires authentication and CREATE_USER permission)
   */
  async createUser(data: {
    name: string;
    contact: string;
    department?: string;
    permissions?: string[];
    isAdmin?: boolean;
  }): Promise<CreateUserResponse> {
    const response = await this.client.post("/api/users", data);
    return response.data;
  }

  /**
   * Get own user profile
   */
  async getOwnProfile(): Promise<UserResponseWithCreatedUsers> {
    const response = await this.client.get("/api/users/me");
    return response.data;
  }

  /**
   * Update own user profile
   */
  async updateOwnProfile(data: {
    name?: string;
    contact?: string;
    department?: string;
  }): Promise<ApiUser> {
    const response = await this.client.put("/api/users/me", data);
    return response.data;
  }

  /**
   * Revoke own API key
   */
  async revokeOwnKey(): Promise<DeleteUserResponse> {
    const response = await this.client.post("/api/users/me/revoke");
    return response.data;
  }

  /**
   * Revoke a user created by the current user (cascades to all descendants)
   */
  async revokeCreatedUser(userId: string): Promise<DeleteAllUsersResponse> {
    const response = await this.client.post(`/api/users/${userId}/revoke`);
    return response.data;
  }

  /**
   * Revoke ALL users created by the current user (cascades to all descendants)
   */
  async revokeAllCreatedUsers(): Promise<DeleteAllUsersResponse> {
    const response = await this.client.post("/api/users/me/revoke-all");
    return response.data;
  }

  /**
   * List all users (requires LIST_USERS permission or admin)
   */
  async listUsers(includeRevoked = false): Promise<ApiUser[]> {
    const response = await this.client.get("/api/users", {
      params: { include_revoked: includeRevoked },
    });
    return response.data;
  }

  /**
   * Get user by name (admin only)
   */
  async getUserByName(name: string): Promise<ApiUser> {
    const response = await this.client.get(`/api/users/by-name/${name}`);
    return response.data;
  }

  /**
   * Revoke user by name (admin only)
   */
  async revokeUserByName(name: string): Promise<DeleteUserResponse> {
    const response = await this.client.post(`/api/users/by-name/${name}/revoke`);
    return response.data;
  }

  /**
   * Get own permissions
   */
  async getOwnPermissions(): Promise<UserPermissionsResponse> {
    const response = await this.client.get("/api/permissions/me");
    return response.data;
  }

  /**
   * Get permissions for a specific user by ID
   */
  async getUserPermissions(userId: string): Promise<UserPermissionsResponse> {
    const response = await this.client.get(`/api/permissions/user-id/${userId}`);
    return response.data;
  }

  /**
   * Add permission to user
   */
  async addPermission(userId: string, permissions: string[], propagate?: boolean): Promise<ChangePermissionResponse> {
    const response = await this.client.post(`/api/permissions/user-id/${userId}/add`, {
      permissions: permissions,
      propagate: propagate || false,
    });
    return response.data;
  }

  /**
   * Remove permissions from user (cascades to all descendants)
   * Non-admins can only revoke permissions they have from users they created
   */
  async removePermission(userId: string, permissions: string[]): Promise<ChangePermissionResponse> {
    const response = await this.client.post(
      `/api/permissions/user-id/${userId}/remove`,
      { permissions }
    );
    return response.data;
  }

  /**
   * List all available permission types
   */
  async listPermissions(): Promise<PermissionTypes> {
    const response = await this.client.get("/api/permissions");
    return response.data;
  }

  /**
   * Bind credentials for a bundle token + MCP namespace
   */
  async bindCredential(bundleToken: string, namespace: string, authConfig: MCPAuthConfig): Promise<CredentialResponse> {
    const response = await this.client.post(
      `/api/credentials/${namespace}`,
      { authConfig },
      { headers: { "X-Bundle-Token": bundleToken } }
    );
    return response.data;
  }

  /**
   * Update credentials for a bundle token + MCP namespace
   */
  async updateCredential(bundleToken: string, namespace: string, authConfig: MCPAuthConfig): Promise<CredentialResponse> {
    const response = await this.client.put(
      `/api/credentials/${namespace}`,
      { authConfig },
      { headers: { "X-Bundle-Token": bundleToken } }
    );
    return response.data;
  }

  /**
   * Remove credentials for a bundle token + MCP namespace
   */
  async removeCredential(bundleToken: string, namespace: string): Promise<void> {
    await this.client.delete(`/api/credentials/${namespace}`, {
      headers: { "X-Bundle-Token": bundleToken },
    });
  }

  /**
   * List all credentials for a bundle token
   */
  async listCredentials(bundleToken: string): Promise<Credential[]> {
    const response = await this.client.get("/api/credentials", {
      headers: { "X-Bundle-Token": bundleToken },
    });
    return response.data;
  }
}
