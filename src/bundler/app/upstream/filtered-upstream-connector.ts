import { EventEmitter } from "events";
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
  Tool,
  Resource,
  ResourceTemplate,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import { INamespaceService } from "../core/namespace-resolver.js";
import { IPermissionService } from "../core/permission-manager.js";
import { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { IUpstreamConnector, UpstreamEventPayload, UPSTREAM_EVENTS } from "../../domain/upstream.js";
import { MCPConfig } from "../../core/schemas.js";
import logger from "../../../shared/utils/logger.js";

/**
 * Decorator for UpstreamConnector that applies:
 * 1. Namespace prefixing to tool/resource/prompt names
 * 2. Permission filtering based on upstream config
 * 3. Event forwarding from delegate
 */
export class FilteredUpstreamConnector extends EventEmitter implements IUpstreamConnector {
  constructor(
    private readonly delegate: IUpstreamConnector,
    private readonly config: MCPConfig,
    private readonly namespaceService: INamespaceService,
    private readonly permissionService: IPermissionService
  ) {
    super();
    this.setupEventForwarding();
  }

  /**
   * Forward events from delegate to this connector.
   * Ensures listeners attached to FilteredUpstreamConnector receive events.
   */
  private setupEventForwarding(): void {
    const events = [
      UPSTREAM_EVENTS.TOOLS_LIST_CHANGED,
      UPSTREAM_EVENTS.RESOURCES_LIST_CHANGED,
      UPSTREAM_EVENTS.PROMPTS_LIST_CHANGED,
      UPSTREAM_EVENTS.CONNECTED,
      UPSTREAM_EVENTS.DISCONNECTED,
      UPSTREAM_EVENTS.CONNECTION_FAILED,
      UPSTREAM_EVENTS.RECONNECTION_ATTEMPT,
    ];

    for (const event of events) {
      this.delegate.on(event, (payload: UpstreamEventPayload) => {
        this.emit(event, payload);
      });
    }
  }

  async connect(): Promise<void> {
    return this.delegate.connect();
  }

  async disconnect(): Promise<void> {
    return this.delegate.disconnect();
  }

  async reconnect(): Promise<void> {
    return this.delegate.reconnect();
  }

  isConnected(): boolean {
    return this.delegate.isConnected();
  }

  getNamespace(): string {
    return this.delegate.getNamespace();
  }

  getCapabilities() {
    return this.delegate.getCapabilities();
  }

  async callTool(params: CallToolRequest["params"], options?: RequestOptions): Promise<CallToolResult> {
    // Reverse namespace lookup: client sends prefixed/hashed name, we need original
    const extracted = this.namespaceService.extractNamespaceFromName(params.name);

    // Check permissions using the extracted address (original tool name)
    if (!this.permissionService.isToolAllowed(this.config, extracted.address)) {
      logger.warn({ namespace: this.config.namespace, tool: extracted.address }, "Tool call blocked by permissions");
      throw new Error(`Tool not allowed: ${extracted.address}`);
    }

    // Forward with original name
    return this.delegate.callTool({
      ...params,
      name: extracted.address
    }, options);
  }

  async listTools(params?: ListToolsRequest["params"], options?: RequestOptions): Promise<ListToolsResult> {
    const result = await this.delegate.listTools(params, options);

    // Apply permission filtering and namespace prefixing
    const filteredTools = result.tools
      .filter((tool: Tool) => this.permissionService.isToolAllowed(this.config, tool.name))
      .map((tool: Tool) => this.namespaceService.namespaceTool(this.config.namespace, tool));

    logger.debug({
      namespace: this.config.namespace,
      original: result.tools.length,
      filtered: filteredTools.length
    }, "Tools filtered and namespaced");

    return {
      ...result,
      tools: filteredTools
    };
  }

  async listResources(params?: ListResourcesRequest["params"], options?: RequestOptions): Promise<ListResourcesResult> {
    const result = await this.delegate.listResources(params, options);

    // Apply permission filtering and namespace prefixing
    const filteredResources = result.resources
      .filter((resource: Resource) => this.permissionService.isResourceAllowed(this.config, resource.uri))
      .map((resource: Resource) => this.namespaceService.namespaceResource(this.config.namespace, resource));

    logger.debug({
      namespace: this.config.namespace,
      original: result.resources.length,
      filtered: filteredResources.length
    }, "Resources filtered and namespaced");

    return {
      ...result,
      resources: filteredResources
    };
  }

  async readResource(params: ReadResourceRequest["params"], options?: RequestOptions): Promise<ReadResourceResult> {
    // Extract original URI by removing namespace query parameter
    const extracted = this.namespaceService.extractNamespaceFromUri(params.uri);
    const originalUri = extracted.address;

    // Check permissions using the original URI
    if (!this.permissionService.isResourceAllowed(this.config, originalUri)) {
      logger.warn({ namespace: this.config.namespace, uri: originalUri }, "Resource read blocked by permissions");
      throw new Error(`Resource not allowed: ${originalUri}`);
    }

    // Forward with original URI
    return this.delegate.readResource({
      ...params,
      uri: originalUri
    }, options);
  }

  async listResourceTemplates(params?: ListResourceTemplatesRequest["params"], options?: RequestOptions): Promise<ListResourceTemplatesResult> {
    const result = await this.delegate.listResourceTemplates(params, options);

    // Apply permission filtering and namespace prefixing
    const filteredTemplates = result.resourceTemplates
      .filter((template: ResourceTemplate) => this.permissionService.isResourceAllowed(this.config, template.uriTemplate))
      .map((template: ResourceTemplate) => this.namespaceService.namespaceResourceTemplate(this.config.namespace, template));

    logger.debug({
      namespace: this.config.namespace,
      original: result.resourceTemplates.length,
      filtered: filteredTemplates.length
    }, "Resource templates filtered and namespaced");

    return {
      ...result,
      resourceTemplates: filteredTemplates
    };
  }

  async listPrompts(params?: ListPromptsRequest["params"], options?: RequestOptions): Promise<ListPromptsResult> {
    const result = await this.delegate.listPrompts(params, options);

    // Apply permission filtering and namespace prefixing
    const filteredPrompts = result.prompts
      .filter((prompt: Prompt) => this.permissionService.isPromptAllowed(this.config, prompt.name))
      .map((prompt: Prompt) => this.namespaceService.namespacePrompt(this.config.namespace, prompt));

    logger.debug({
      namespace: this.config.namespace,
      original: result.prompts.length,
      filtered: filteredPrompts.length
    }, "Prompts filtered and namespaced");

    return {
      ...result,
      prompts: filteredPrompts
    };
  }

  async getPrompt(params: GetPromptRequest["params"], options?: RequestOptions): Promise<GetPromptResult> {
    // Extract original name from prefixed name
    const extracted = this.namespaceService.extractNamespaceFromName(params.name);

    // Check permissions using the original name
    if (!this.permissionService.isPromptAllowed(this.config, extracted.address)) {
      logger.warn({ namespace: this.config.namespace, prompt: extracted.address }, "Prompt get blocked by permissions");
      throw new Error(`Prompt not allowed: ${extracted.address}`);
    }

    // Forward with original name
    return this.delegate.getPrompt({
      ...params,
      name: extracted.address
    }, options);
  }

}
