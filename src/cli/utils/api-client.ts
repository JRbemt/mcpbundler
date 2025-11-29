import axios, { AxiosInstance } from "axios";

export interface UpstreamConfig {
  namespace: string;
  url: string;
  version?: string;
  stateless?: boolean;
  auth?: {
    method: string;
    [key: string]: any;
  };
}

export interface Collection {
  id: string;
  name: string;
  mcps: UpstreamConfig[];
  created_at: string;
}

export interface Mcp {
  id: string;
  namespace: string;
  url: string;
  author: string;
  description: string;
  version: string;
  stateless: boolean;
  token_cost: number;
  auth_strategy?: "MASTER" | "TOKEN_SPECIFIC" | "NONE";
  master_auth_config?: string;
  created_at: string;
  updated_at: string;
}

export interface ApiUser {
  id: string;
  name: string;
  contact: string;
  department?: string;
  is_admin: boolean;
  permissions: string[];
  created_at: string;
  last_used_at?: string;
  revoked_at?: string;
  api_key?: string;
  created_by?: string;
  created_users?: ApiUser[];
}

export interface PermissionTypes {
  permissions: string[];
  descriptions: Record<string, string>;
}

export class BundlerAPIClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(portOrUrl: string, token?: string) {
    // Support both port number (localhost) and full URL (remote)
    this.baseUrl = portOrUrl;

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
   * List all collections
   */
  async listCollections(): Promise<Collection[]> {
    const response = await this.client.get("/api/collections");
    return response.data;
  }

  /**
   * Get a specific collection
   */
  async getCollection(collectionId: string): Promise<Collection> {
    const response = await this.client.get(`/api/collections/${collectionId}`);
    return response.data;
  }

  /**
   * Create a new collection
   */
  async createCollection(name: string): Promise<Collection> {
    const response = await this.client.post("/api/collections", { name });
    return response.data;
  }

  /**
   * Delete a collection by ID
   */
  async deleteCollection(collectionId: string): Promise<void> {
    await this.client.delete(`/api/collections/${collectionId}`);
  }

  /**
   * Add MCP to a collection
   */
  async addMcpToCollection(collectionId: string, config: UpstreamConfig): Promise<void> {
    await this.client.post(`/api/collections/${collectionId}/mcps`, config);
  }

  /**
   * Delete MCP from a collection
   */
  async deleteMcpFromCollection(collectionId: string, namespace: string): Promise<void> {
    await this.client.delete(`/api/collections/${collectionId}/mcps/${namespace}`);
  }

  /**
   * List MCPs in a collection
   */
  async listCollectionMcps(collectionId: string): Promise<UpstreamConfig[]> {
    const response = await this.client.get(`/api/collections/${collectionId}/mcps`);
    return response.data;
  }

  /**
   * Generate access token for a collection
   */
  async generateToken(collectionId: string): Promise<{ token: string }> {
    const response = await this.client.post(`/api/collections/${collectionId}/tokens`);
    return response.data;
  }

  /**
   * List all master MCPs
   */
  async listMcps(): Promise<Mcp[]> {
    const response = await this.client.get("/api/mcps");
    return response.data;
  }

  /**
   * Get MCP by namespace
   */
  async getMcpByNamespace(namespace: string): Promise<Mcp> {
    const response = await this.client.get(`/api/mcps/namespace/${namespace}`);
    return response.data;
  }

  /**
   * Create a master MCP
   */
  async createMcp(config: UpstreamConfig): Promise<Mcp> {
    const response = await this.client.post("/api/mcps", config);
    return response.data;
  }

  /**
   * Get a specific MCP by ID
   */
  async getMcp(mcpId: string): Promise<Mcp> {
    const response = await this.client.get(`/api/mcps/${mcpId}`);
    return response.data;
  }

  /**
   * Update a master MCP
   */
  async updateMcp(mcpId: string, config: Partial<UpstreamConfig>): Promise<Mcp> {
    const response = await this.client.put(`/api/mcps/${mcpId}`, config);
    return response.data;
  }

  /**
   * Delete a master MCP
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
  }): Promise<ApiUser> {
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
  }): Promise<ApiUser> {
    const response = await this.client.post("/api/users", data);
    return response.data;
  }

  /**
   * Get own user profile
   */
  async getOwnProfile(): Promise<ApiUser> {
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
  async revokeOwnKey(): Promise<{ message: string; revoked_at: string }> {
    const response = await this.client.post("/api/users/me/revoke");
    return response.data;
  }

  /**
   * Revoke a user created by the current user (cascades to all descendants)
   */
  async revokeCreatedUser(userId: string): Promise<{
    message: string;
    revoked_user_id: string;
    total_revoked: number;
    revoked_user_ids: string[];
  }> {
    const response = await this.client.post(`/api/users/me/created/${userId}/revoke`);
    return response.data;
  }

  /**
   * Revoke ALL users created by the current user (cascades to all descendants)
   */
  async revokeAllCreatedUsers(): Promise<{
    message: string;
    direct_users_revoked: number;
    total_revoked: number;
    revoked_user_ids: string[];
  }> {
    const response = await this.client.post("/api/users/me/created/revoke-all");
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
  async revokeUserByName(name: string): Promise<{ message: string; user: any }> {
    const response = await this.client.post(`/api/users/by-name/${name}/revoke`);
    return response.data;
  }

  /**
   * Get own permissions
   */
  async getOwnPermissions(): Promise<{
    user_id: string;
    user_name: string;
    is_admin: boolean;
    permissions: string[];
  }> {
    const response = await this.client.get("/api/permissions/me");
    return response.data;
  }

  /**
   * Get permissions for a specific user by name (admin only)
   */
  async getUserPermissions(username: string): Promise<{
    user_id: string;
    user_name: string;
    is_admin: boolean;
    permissions: Array<{ id: string; permission: string }>;
  }> {
    const response = await this.client.get(`/api/permissions/by-name/${username}`);
    return response.data;
  }

  /**
   * Add permission to user
   */
  async addPermission(username: string, permission: string, propagate?: boolean): Promise<{
    message: string;
    user: any;
    permission: string;
    affected_users: number;
  }> {
    const response = await this.client.post(`/api/permissions/by-name/${username}`, {
      permission,
      propagate: propagate || false,
    });
    return response.data;
  }

  /**
   * Remove permission from user (cascades to all descendants)
   * Non-admins can only revoke permissions they have from users they created
   */
  async removePermission(username: string, permission: string): Promise<{
    message: string;
    user: any;
    permission: string;
    affected_users: number;
  }> {
    const response = await this.client.delete(
      `/api/permissions/by-name/${username}/${permission}`
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
}
