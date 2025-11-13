import axios, { AxiosInstance } from 'axios';

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
  created_at: string;
  updated_at: string;
}

export class BundlerAPIClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(portOrUrl: number | string, token?: string) {
    // Support both port number (localhost) and full URL (remote)
    if (typeof portOrUrl === 'number') {
      this.baseUrl = `http://localhost:${portOrUrl}`;
    } else {
      this.baseUrl = portOrUrl;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add auth token for remote servers
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
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
      await this.client.get('/metrics');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get server metrics
   */
  async getMetrics(): Promise<any> {
    const response = await this.client.get('/metrics');
    return response.data;
  }

  /**
   * List all collections
   */
  async listCollections(): Promise<Collection[]> {
    const response = await this.client.get('/api/collections');
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
    const response = await this.client.post('/api/collections', { name });
    return response.data;
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
    const response = await this.client.get('/api/mcps');
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
    const response = await this.client.post('/api/mcps', config);
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
}
