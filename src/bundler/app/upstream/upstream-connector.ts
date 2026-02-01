import { EventEmitter } from "events";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolRequest,
  CallToolResult,
  ListToolsRequest,
  ListToolsResult,
  ListResourcesRequest,
  ListResourcesResult,
  ListResourceTemplatesRequest,
  ListResourceTemplatesResult,
  ListPromptsRequest,
  ListPromptsResult,
  GetPromptRequest,
  GetPromptResult,
  ReadResourceRequest,
  ReadResourceResult,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema
} from "@modelcontextprotocol/sdk/types.js";
import { buildAuthOptions } from "./upstream-auth.js";
import { validateUpstreamUrl } from "../utils/ssrf-protection.js";
import { upstreamRequestDurationHistogram, upstreamErrorCounter } from "../utils/metrics.js";
import { MCPConfig } from "../../core/schemas.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { IUpstreamConnector, UpstreamEventPayload, UPSTREAM_EVENTS } from "../../domain/upstream.js";
import logger from "../../../shared/utils/logger.js";

export class HttpUpstreamConnector extends EventEmitter implements IUpstreamConnector {
  private transport?: StreamableHTTPClientTransport;
  private client?: Client;
  private config?: MCPConfig;
  private connected = false;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly baseReconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private lastHealthCheck?: Date;
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly healthCheckIntervalMs = 30000; // 30 seconds
  private autoReconnect = true;

  constructor() {
    super();
  }

  async connect(): Promise<void> {
    if (!this.config) {
      throw new Error("Connector not initialized with config");
    }

    // Idempotent: if already connected, return early
    if (this.connected && this.client && this.transport) {
      logger.debug({ namespace: this.config.namespace }, "Already connected, skipping reconnect");
      return;
    }

    // SSRF Protection: Validate upstream URL
    const validationResult = validateUpstreamUrl(this.config.url, {
      allowPrivateIPs: process.env.NODE_ENV === "development", // Allow in dev, block in prod
      allowLocalhost: process.env.NODE_ENV === "development",
      allowedSchemes: ["http", "https"]
    });

    if (!validationResult.allowed) {
      logger.warn({
        namespace: this.config.namespace,
        url: this.config.url,
        reason: validationResult.reason
      }, "SSRF protection: Upstream URL rejected");

      throw new Error(`Upstream URL validation failed: ${validationResult.reason}`);
    }

    try {
      const authOptions = buildAuthOptions(this.config.auth);
      const url = new URL(this.config.url);

      this.transport = new StreamableHTTPClientTransport(url, {
        ...authOptions,
        sessionId: this.config.stateless ? undefined : undefined // Let SDK generate
      });

      this.client = new Client(
        {
          name: "mcp-bundler-upstream",
          version: "1.0.0"
        },
        {
          capabilities: {}
        }
      );

      await this.client.connect(this.transport);

      // Set up notification handlers for list change events - emit as UPSTREAM_EVENTS
      this.client.setNotificationHandler(ToolListChangedNotificationSchema, (notification) => {
        const payload: UpstreamEventPayload = {
          namespace: this.config?.namespace || "",
          eventType: UPSTREAM_EVENTS.TOOLS_LIST_CHANGED,
          params: notification.params
        };
        logger.debug({ namespace: payload.namespace }, "Tools list changed notification received");
        this.emit(UPSTREAM_EVENTS.TOOLS_LIST_CHANGED, payload);
      });

      this.client.setNotificationHandler(ResourceListChangedNotificationSchema, (notification) => {
        const payload: UpstreamEventPayload = {
          namespace: this.config?.namespace || "",
          eventType: UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED,
          params: notification.params
        };
        logger.debug({ namespace: payload.namespace }, "Resources list changed notification received");
        this.emit(UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED, payload);
      });

      this.client.setNotificationHandler(PromptListChangedNotificationSchema, (notification) => {
        const payload: UpstreamEventPayload = {
          namespace: this.config?.namespace || "",
          eventType: UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED,
          params: notification.params
        };
        logger.debug({ namespace: payload.namespace }, "Prompts list changed notification received");
        this.emit(UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED, payload);
      });

      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastHealthCheck = new Date();

      // Start health monitoring for stateful connections
      if (!this.config.stateless) {
        this.startHealthMonitoring();
      }

      logger.info({ namespace: this.config.namespace, url: this.config.url }, "Upstream connected");

      return;
    } catch (error: any) {
      this.connected = false;
      logger.error(
        { namespace: this.config?.namespace, url: this.config?.url, error: error.message },
        "Failed to connect to upstream"
      );
      throw new Error(`Upstream connection failed: ${error.message}`);
    }
  }

  async disconnect(): Promise<void> {
    this.stopHealthMonitoring();
    this.connected = false;

    if (this.transport) {
      try {
        // Timeout disconnect to prevent hanging on unresponsive upstreams
        const timeoutMs = 5000;
        await Promise.race([
          this.transport.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Disconnect timeout")), timeoutMs)
          )
        ]);
        logger.info({ namespace: this.config?.namespace }, "Upstream disconnected");
      } catch (error: any) {
        // AbortError and timeout are expected when closing with pending operations
        if (error.name === "AbortError" || error.message === "Disconnect timeout") {
          logger.debug({ namespace: this.config?.namespace }, "Upstream disconnect completed (aborted or timed out)");
        } else {
          logger.error(
            { namespace: this.config?.namespace, error: error.message },
            "Error during upstream disconnect"
          );
        }
      }
      this.transport = undefined;
      this.client = undefined;
    }
  }

  async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      throw new Error("Max reconnection attempts reached");
    }

    await this.disconnect();

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;

    logger.info(
      { namespace: this.config?.namespace, attempt: this.reconnectAttempts, delay },
      "Scheduling reconnection"
    );

    await this.sleep(delay);
    return this.connect();
  }

  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.healthCheckIntervalMs);

    logger.debug({ namespace: this.config?.namespace }, "Health monitoring started");
  }

  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
      logger.debug({ namespace: this.config?.namespace }, "Health monitoring stopped");
    }
  }

  private async performHealthCheck(): Promise<void> {
    if (!this.connected || !this.client) {
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        await this.client.ping({ signal: controller.signal });
        this.lastHealthCheck = new Date();
        logger.debug({ namespace: this.config?.namespace }, "Health check passed");
      } finally {
        clearTimeout(timeout);
      }
    } catch (error: any) {
      logger.warn(
        { namespace: this.config?.namespace, error: error.message },
        "Health check failed"
      );

      this.connected = false;

      if (this.autoReconnect) {
        logger.info({ namespace: this.config?.namespace }, "Auto-reconnecting after failed health check");
        try {
          const result = await this.reconnect();
          logger.info({ namespace: this.config?.namespace }, "Auto-reconnection successful");
        } catch (err: unknown) {
          logger.error(
            { namespace: this.config?.namespace, error: err instanceof Error ? err.message : String(err) },
            "Auto-reconnection failed"
          );
        }

      }
    }
  }

  setAutoReconnect(enabled: boolean): void {
    this.autoReconnect = enabled;
    logger.info({ namespace: this.config?.namespace, enabled }, "Auto-reconnect setting changed");
  }

  getLastHealthCheck(): Date | undefined {
    return this.lastHealthCheck;
  }

  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
    logger.debug({ namespace: this.config?.namespace }, "Reconnect attempts reset");
  }

  isConnected(): boolean {
    return this.connected;
  }

  getNamespace(): string {
    return this.config?.namespace || "";
  }

  getCapabilities() {
    return this.client?.getServerCapabilities();
  }

  initialize(config: MCPConfig): void {
    this.config = config;
  }

  async callTool(params: CallToolRequest["params"], options?: RequestOptions): Promise<CallToolResult> {
    if (!this.client || !this.connected) {
      throw new Error("Upstream not connected");
    }

    return this.trackOperation("callTool", async () => {
      try {
        const result = await this.client!.callTool(params, undefined, {
          signal: options?.signal,
          onprogress: options?.onprogress
        });
        return result as CallToolResult;
      } catch (error: any) {
        logger.error(
          { namespace: this.config?.namespace, tool: params.name, error: error.message },
          "Tool call failed"
        );
        throw error;
      }
    });
  }

  async listTools(params?: ListToolsRequest["params"], options?: RequestOptions): Promise<ListToolsResult> {
    if (!this.client || !this.connected) {
      throw new Error("Upstream not connected");
    }

    return this.trackOperation("listTools", async () => {
      const result = await this.client!.listTools(params || {}, {
        signal: options?.signal
      });
      return result as ListToolsResult;
    });
  }

  async listResources(params?: ListResourcesRequest["params"], options?: RequestOptions): Promise<ListResourcesResult> {
    if (!this.client || !this.connected) {
      throw new Error("Upstream not connected");
    }

    return this.trackOperation("listResources", async () => {
      const result = await this.client!.listResources(params || {}, options);
      return result as ListResourcesResult;
    });
  }

  async readResource(params: ReadResourceRequest["params"], options?: RequestOptions): Promise<ReadResourceResult> {
    if (!this.client || !this.connected) {
      throw new Error("Upstream not connected");
    }

    return this.trackOperation("readResource", async () => {
      try {
        const result = await this.client!.readResource(params, options);
        return result as ReadResourceResult;
      } catch (error: any) {
        logger.error({ namespace: this.config?.namespace, uri: params.uri, error: error.message }, "Resource read failed");
        throw error;
      }
    });
  }

  async listResourceTemplates(params?: ListResourceTemplatesRequest["params"], options?: RequestOptions): Promise<ListResourceTemplatesResult> {
    if (!this.client || !this.connected) {
      throw new Error("Upstream not connected");
    }

    return this.trackOperation("listResourceTemplates", async () => {
      const result = await this.client!.listResourceTemplates(params || {}, options);
      return result as ListResourceTemplatesResult;
    });
  }

  async listPrompts(params?: ListPromptsRequest["params"], options?: RequestOptions): Promise<ListPromptsResult> {
    if (!this.client || !this.connected) {
      throw new Error("Upstream not connected");
    }

    return this.trackOperation("listPrompts", async () => {
      const result = await this.client!.listPrompts(params || {}, options);
      return result as ListPromptsResult;
    });
  }

  async getPrompt(params: GetPromptRequest["params"], options?: RequestOptions): Promise<GetPromptResult> {
    if (!this.client || !this.connected) {
      throw new Error("Upstream not connected");
    }

    return this.trackOperation("getPrompt", async () => {
      try {
        const result = await this.client!.getPrompt(params, options);
        return result as GetPromptResult;
      } catch (error: any) {
        logger.error({ namespace: this.config?.namespace, prompt: params.name, error: error.message }, "Prompt get failed");
        throw error;
      }
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Track upstream operation metrics
   */
  private async trackOperation<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const namespace = this.config?.namespace || "unknown";
    const end = upstreamRequestDurationHistogram.startTimer({ namespace, operation });

    try {
      const result = await fn();
      end();
      return result;
    } catch (error: any) {
      end();
      upstreamErrorCounter.inc({ namespace, operation, error_type: error.constructor.name });
      throw error;
    }
  }
}
