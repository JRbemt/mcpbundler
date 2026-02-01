/**
 * STDIO to SSE Bridge
 *
 * This class bridges MCP STDIO protocol to the mcpbundler"s SSE endpoint.
 * It acts as an MCP STDIO server (for clients like Claude Desktop) while
 * connecting to the bundler as an SSE client.
 *
 * Flow:
 * Claude Desktop (STDIO) <-> StdioToSseBridge <-> MCPBundler (SSE) <-> Upstream Servers
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import logger from "../../../../shared/utils/logger.js";

export interface BridgeConfig {
  /** Bundler SSE endpoint URL (e.g., http://localhost:3000) */
  bundlerUrl: string;
  /** Authentication token for the bundler */
  token?: string;
  /** Optional server info override */
  serverInfo?: {
    name: string;
    version: string;
  };
}

export class StdioToSseBridge {
  private stdioServer: Server;
  private sseClient: Client;
  private sseTransport: SSEClientTransport;
  private config: BridgeConfig;
  private connected: boolean = false;

  constructor(config: BridgeConfig) {
    this.config = config;

    // Create STDIO MCP server (listens on stdin/stdout)
    this.stdioServer = new Server(
      {
        name: config.serverInfo?.name || "mcpbundler-stdio-client",
        version: config.serverInfo?.version || "1.0.0",
      },
      {
        capabilities: {
          tools: {
            listChanged: true,
          },
          resources: {
            listChanged: true,
          },
          prompts: {
            listChanged: true,
          },
        },
      }
    );

    // Create SSE client transport to connect to bundler
    const sseUrl = new URL("/sse", this.config.bundlerUrl);

    // Build transport options with Authorization header if token provided
    const transportOptions: any = {};

    if (this.config.token) {
      const authHeaders = {
        "Authorization": `Bearer ${this.config.token}`
      };

      // Custom fetch to inject Authorization header into EventSource (SSE GET)
      transportOptions.eventSourceInit = {
        fetch: async (url: string | URL, init: any) => {
          return fetch(url, {
            ...init,
            headers: {
              ...init.headers,
              ...authHeaders
            }
          });
        }
      };

      // Headers for POST requests
      transportOptions.requestInit = {
        headers: authHeaders
      };
    }

    this.sseTransport = new SSEClientTransport(sseUrl, Object.keys(transportOptions).length > 0 ? transportOptions : undefined);

    // Create MCP client for SSE connection
    this.sseClient = new Client(
      {
        name: "mcpbundler-stdio-bridge",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    this.setupRequestHandlers();
    this.setupNotifications();
  }

  /**
   * Setup request handlers to proxy all MCP requests from STDIO to SSE
   */
  private setupRequestHandlers(): void {
    // Proxy tools/list
    this.stdioServer.setRequestHandler(ListToolsRequestSchema, async (request) => {
      logger.debug({ method: "tools/list", params: request.params }, "Proxying request to bundler");
      return await this.sseClient.request(
        { method: "tools/list", params: request.params },
        ListToolsRequestSchema
      );
    });

    // Proxy tools/call
    this.stdioServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      logger.debug({ method: "tools/call", tool: request.params.name }, "Proxying request to bundler");
      return await this.sseClient.request(
        { method: "tools/call", params: request.params },
        CallToolRequestSchema
      );
    });

    // Proxy resources/list
    this.stdioServer.setRequestHandler(ListResourcesRequestSchema, async (request) => {
      logger.debug({ method: "resources/list", params: request.params }, "Proxying request to bundler");
      return await this.sseClient.request(
        { method: "resources/list", params: request.params },
        ListResourcesRequestSchema
      );
    });

    // Proxy resources/templates/list
    this.stdioServer.setRequestHandler(ListResourceTemplatesRequestSchema, async (request) => {
      logger.debug({ method: "resources/templates/list" }, "Proxying request to bundler");
      return await this.sseClient.request(
        { method: "resources/templates/list", params: request.params },
        ListResourceTemplatesRequestSchema
      );
    });

    // Proxy resources/read
    this.stdioServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      logger.debug({ method: "resources/read", uri: request.params.uri }, "Proxying request to bundler");
      return await this.sseClient.request(
        { method: "resources/read", params: request.params },
        ReadResourceRequestSchema
      );
    });

    // Proxy prompts/list
    this.stdioServer.setRequestHandler(ListPromptsRequestSchema, async (request) => {
      logger.debug({ method: "prompts/list" }, "Proxying request to bundler");
      return await this.sseClient.request(
        { method: "prompts/list", params: request.params },
        ListPromptsRequestSchema
      );
    });

    // Proxy prompts/get
    this.stdioServer.setRequestHandler(GetPromptRequestSchema, async (request) => {
      logger.debug({ method: "prompts/get", name: request.params.name }, "Proxying request to bundler");
      return await this.sseClient.request(
        { method: "prompts/get", params: request.params },
        GetPromptRequestSchema
      );
    });
  }

  /**
   * Setup notification handlers to forward bundler notifications to STDIO client
   */
  private setupNotifications(): void {
    // Forward tools list changed notifications
    this.sseClient.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async (notification) => {
        logger.debug("Forwarding tools/list_changed notification to STDIO client");
        await this.stdioServer.notification({
          method: "notifications/tools/list_changed",
          params: {},
        });
      }
    );

    // Forward resources list changed notifications
    this.sseClient.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      async (notification) => {
        logger.debug("Forwarding resources/list_changed notification to STDIO client");
        await this.stdioServer.notification({
          method: "notifications/resources/list_changed",
          params: {},
        });
      }
    );

    // Forward prompts list changed notifications
    this.sseClient.setNotificationHandler(
      PromptListChangedNotificationSchema,
      async (notification) => {
        logger.debug("Forwarding prompts/list_changed notification to STDIO client");
        await this.stdioServer.notification({
          method: "notifications/prompts/list_changed",
          params: {},
        });
      }
    );
  }

  /**
   * Start the bridge - connects to bundler and starts STDIO server
   */
  async start(): Promise<void> {
    try {
      // Connect SSE client to bundler first
      logger.info({ bundlerUrl: this.config.bundlerUrl }, "Connecting to mcpbundler via SSE");
      await this.sseClient.connect(this.sseTransport);
      this.connected = true;
      logger.info("Successfully connected to mcpbundler");

      // Start STDIO server
      const transport = new StdioServerTransport();
      await this.stdioServer.connect(transport);
      logger.info("STDIO server started, ready to accept MCP requests");

      // Handle transport close
      this.sseTransport.onclose = () => {
        logger.warn("SSE connection to bundler closed");
        this.connected = false;
      };

      this.sseTransport.onerror = (error) => {
        logger.error({ error }, "SSE connection error");
      };

    } catch (error) {
      logger.error({ error }, "Failed to start bridge");
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down STDIO-to-SSE bridge");

    try {
      // Close STDIO server
      await this.stdioServer.close();
      logger.debug("STDIO server closed");
    } catch (error) {
      logger.warn({ error }, "Error closing STDIO server");
    }

    try {
      // Close SSE client
      await this.sseClient.close();
      logger.debug("SSE client closed");
    } catch (error) {
      logger.warn({ error }, "Error closing SSE client");
    }

    this.connected = false;
    logger.info("Bridge shutdown complete");
  }

  /**
   * Check if bridge is connected
   */
  isConnected(): boolean {
    return this.connected;
  }
}
