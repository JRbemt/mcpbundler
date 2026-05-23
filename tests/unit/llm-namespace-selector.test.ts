import { describe, it, expect, vi } from "vitest";
import { LLMNamespaceSelector } from "../../src/bundler/core/middleware/llm-router/llm/namespace-selector.js";
import type { LLMClient } from "../../src/bundler/core/middleware/llm-router/llm/llm-client.js";
import type { MCPConfig } from "../../src/bundler/core/schemas.js";

function makeUpstreams(namespaces: string[]): MCPConfig[] {
  return namespaces.map((ns) => ({
    namespace: ns,
    url: `https://${ns}.example.com/mcp`,
    description: `${ns} service`,
    stateless: false,
    authStrategy: "NONE" as const,
    auth: undefined,
    permissions: { allowedTools: ["*"], allowedResources: ["*"], allowedPrompts: ["*"] },
  }));
}

function makeClient(response: string | Error): LLMClient {
  return {
    complete: vi.fn().mockImplementation(() =>
      response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
    ),
  };
}

const UPSTREAMS = makeUpstreams(["github", "jira", "stripe", "filesystem"]);

describe("LLMNamespaceSelector", () => {
  describe("parseNamespaces", () => {
    it("returns selected namespaces from clean JSON response", async () => {
      const client = makeClient(`{"namespaces": ["github", "jira"]}`);
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("create a PR", UPSTREAMS, 4);
      expect(result).toEqual(["github", "jira"]);
    });

    it("strips markdown code fences before parsing", async () => {
      const client = makeClient("```json\n{\"namespaces\": [\"stripe\"]}\n```");
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("charge a card", UPSTREAMS, 4);
      expect(result).toEqual(["stripe"]);
    });

    it("extracts JSON object from surrounding prose", async () => {
      const client = makeClient(
        'Sure, I think these are relevant: {"namespaces": ["filesystem"]} Hope that helps!'
      );
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("read a file", UPSTREAMS, 4);
      expect(result).toEqual(["filesystem"]);
    });

    it("filters out invalid namespace names not in the available set", async () => {
      const client = makeClient(`{"namespaces": ["github", "notion", "stripe"]}`);
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("anything", UPSTREAMS, 4);
      expect(result).toEqual(["github", "stripe"]);
    });

    it("falls back to all-pass when LLM returns empty namespaces array", async () => {
      const client = makeClient(`{"namespaces": []}`);
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("something", UPSTREAMS, 4);
      expect(result).toHaveLength(4);
      expect(result).toContain("github");
    });

    it("falls back to all-pass when LLM returns unparseable text", async () => {
      const client = makeClient("I cannot determine the relevant tools.");
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("something", UPSTREAMS, 4);
      expect(result).toHaveLength(4);
    });

    it("respects maxUpstreams in all-pass fallback", async () => {
      const client = makeClient(`{"namespaces": []}`);
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("something", UPSTREAMS, 2);
      expect(result).toHaveLength(2);
    });

    it("returns empty array when no upstreams are available", async () => {
      const client = makeClient(`{"namespaces": ["github"]}`);
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("context", [], 4);
      expect(result).toEqual([]);
    });

    it("strips plain ``` fences (no json keyword)", async () => {
      const client = makeClient("```\n{\"namespaces\": [\"jira\"]}\n```");
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("track issue", UPSTREAMS, 4);
      expect(result).toEqual(["jira"]);
    });

    it("falls back to all-pass when JSON has wrong shape (no namespaces key)", async () => {
      const client = makeClient(`{"tools": ["github"]}`);
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("task", UPSTREAMS, 4);
      expect(result).toHaveLength(4);
    });

    it("extracts namespaces array from truncated response missing closing brace", async () => {
      const client = makeClient("```json\n{\n  \"namespaces\": [\"github\", \"jira\"]");
      const selector = new LLMNamespaceSelector(client);
      const result = await selector.selectNamespaces("task", UPSTREAMS, 4);
      expect(result).toEqual(["github", "jira"]);
    });
  });

  describe("system prompt", () => {
    it("includes MCP descriptions in the system prompt", async () => {
      const upstreams = makeUpstreams(["github", "stripe"]);
      const client = makeClient(`{"namespaces": ["github"]}`);
      const selector = new LLMNamespaceSelector(client);
      await selector.selectNamespaces("task", upstreams, 4);

      const [systemPrompt] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(systemPrompt).toContain("github service");
      expect(systemPrompt).toContain("stripe service");
    });

    it("omits description for MCPs that have none", async () => {
      const upstreams: MCPConfig[] = [
        { namespace: "bare-ns", url: "https://bare.example.com/mcp", stateless: false, authStrategy: "NONE" as const },
      ];
      const client = makeClient(`{"namespaces": ["bare-ns"]}`);
      const selector = new LLMNamespaceSelector(client);
      await selector.selectNamespaces("task", upstreams, 1);

      const [systemPrompt] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(systemPrompt).toContain("- bare-ns\n");
    });
  });

  describe("error propagation", () => {
    it("propagates Error thrown by the LLM client", async () => {
      const client = makeClient(new Error("connection refused"));
      const selector = new LLMNamespaceSelector(client);
      await expect(selector.selectNamespaces("task", UPSTREAMS, 4)).rejects.toThrow("connection refused");
    });

    it("propagates non-Error rejection from the LLM client", async () => {
      const client: LLMClient = { complete: vi.fn().mockRejectedValue("service unavailable") };
      const selector = new LLMNamespaceSelector(client);
      await expect(selector.selectNamespaces("task", UPSTREAMS, 4)).rejects.toBe("service unavailable");
    });
  });

  describe("prompt enrichment", () => {
    it("includes capabilities in the system prompt", async () => {
      const upstreams: MCPConfig[] = [{
        namespace: "github",
        url: "https://github.example.com/mcp",
        stateless: false,
        authStrategy: "NONE" as const,
        capabilities: ["git", "code-review"],
      }];
      const client = makeClient(`{"namespaces": ["github"]}`);
      const selector = new LLMNamespaceSelector(client);
      await selector.selectNamespaces("task", upstreams, 4);

      const [systemPrompt] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(systemPrompt).toContain("capabilities: git, code-review");
    });

    it("includes tool names from MCPConfig.tools in the system prompt", async () => {
      const upstreams: MCPConfig[] = [{
        namespace: "github",
        url: "https://github.example.com/mcp",
        stateless: false,
        authStrategy: "NONE" as const,
        tools: [{ name: "create_issue" }, { name: "list_prs" }],
      }];
      const client = makeClient(`{"namespaces": ["github"]}`);
      const selector = new LLMNamespaceSelector(client);
      await selector.selectNamespaces("task", upstreams, 4);

      const [systemPrompt] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(systemPrompt).toContain("tools: create_issue, list_prs");
    });

    it("falls back to liveCatalog tool names when MCPConfig.tools is absent", async () => {
      const upstreams: MCPConfig[] = [{
        namespace: "github",
        url: "https://github.example.com/mcp",
        stateless: false,
        authStrategy: "NONE" as const,
      }];
      const liveCatalog = new Map([["github", ["create_issue", "search_code"]]]);
      const client = makeClient(`{"namespaces": ["github"]}`);
      const selector = new LLMNamespaceSelector(client);
      await selector.selectNamespaces("task", upstreams, 4, liveCatalog);

      const [systemPrompt] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(systemPrompt).toContain("tools: create_issue, search_code");
    });

    it("prefers MCPConfig.tools over liveCatalog when both are present", async () => {
      const upstreams: MCPConfig[] = [{
        namespace: "github",
        url: "https://github.example.com/mcp",
        stateless: false,
        authStrategy: "NONE" as const,
        tools: [{ name: "from_config" }],
      }];
      const liveCatalog = new Map([["github", ["from_live"]]]);
      const client = makeClient(`{"namespaces": ["github"]}`);
      const selector = new LLMNamespaceSelector(client);
      await selector.selectNamespaces("task", upstreams, 4, liveCatalog);

      const [systemPrompt] = (client.complete as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(systemPrompt).toContain("from_config");
      expect(systemPrompt).not.toContain("from_live");
    });
  });
});
