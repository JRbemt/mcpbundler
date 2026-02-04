/**
 * Shared test fixtures for MCPBundler tests
 *
 * Provides reusable test data objects including MCPConfig instances,
 * MCP SDK types (Tool, Resource, Prompt), and common test values.
 */

import type { Tool, Resource, ResourceTemplate, Prompt } from "@modelcontextprotocol/sdk/types.js";
import type { MCPConfig } from "../../src/bundler/core/schemas.js";

// -- Namespaces --

export const NAMESPACE_GITHUB = "github";
export const NAMESPACE_NOTION = "notion";
export const NAMESPACE_FILES = "files";

// -- Tools --

export function createTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "read_file",
    description: "Reads a file from disk",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string" }
      },
      required: ["path"]
    },
    ...overrides,
  };
}

export function createToolWithLongName(namespace: string): Tool {
  const longName = "a_very_long_tool_name_that_exceeds_the_threshold_limit_for_hashing";
  return createTool({ name: longName });
}

// -- Resources --

export function createResource(overrides: Partial<Resource> = {}): Resource {
  return {
    uri: "https://api.example.com/files/readme.md",
    name: "readme.md",
    ...overrides,
  };
}

export function createRelativeResource(): Resource {
  return createResource({
    uri: "file:///local/path/readme.md",
    name: "local-readme",
  });
}

// -- Resource Templates --

export function createResourceTemplate(overrides: Partial<ResourceTemplate> = {}): ResourceTemplate {
  return {
    uriTemplate: "https://api.example.com/files/{path}",
    name: "file-template",
    ...overrides,
  };
}

// -- Prompts --

export function createPrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    name: "summarize",
    description: "Summarizes content",
    ...overrides,
  };
}

// -- MCPConfig objects --

export function createMCPConfig(overrides: Partial<MCPConfig> = {}): MCPConfig {
  return {
    namespace: NAMESPACE_GITHUB,
    url: "https://mcp.github.com",
    stateless: false,
    authStrategy: "NONE",
    ...overrides,
  };
}

export function createMCPConfigWithWildcardPermissions(): MCPConfig {
  return createMCPConfig({
    permissions: {
      allowedTools: ["*"],
      allowedResources: ["*"],
      allowedPrompts: ["*"],
    },
  });
}

export function createMCPConfigWithEmptyPermissions(): MCPConfig {
  return createMCPConfig({
    permissions: {
      allowedTools: [],
      allowedResources: [],
      allowedPrompts: [],
    },
  });
}

export function createMCPConfigWithSpecificPermissions(
  tools: string[] = ["read_file"],
  resources: string[] = ["*"],
  prompts: string[] = ["*"]
): MCPConfig {
  return createMCPConfig({
    permissions: {
      allowedTools: tools,
      allowedResources: resources,
      allowedPrompts: prompts,
    },
  });
}
