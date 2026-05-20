import { describe, it, expect, beforeEach } from "vitest";
import { NamespaceResolver, ToolNameHashMode } from "../../../src/bundler/core/session/namespace-resolver.js";
import {
  createTool,
  createResource,
  createResourceTemplate,
  createPrompt,
  NAMESPACE_GITHUB,
  NAMESPACE_NOTION,
} from "../../helpers/fixtures.js";

describe("NamespaceResolver", () => {
  let resolver: NamespaceResolver;

  beforeEach(() => {
    resolver = new NamespaceResolver("__", ToolNameHashMode.NEVER);
  });

  describe("namespaceTool", () => {
    it("should prefix tool name with namespace", () => {
      const tool = createTool({ name: "read_file" });
      const result = resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      expect(result.name).toBe("github__read_file");
      expect(result.title).toBe("github__read_file");
    });

    it("should preserve original tool properties", () => {
      const tool = createTool({ name: "read_file", description: "Reads a file" });
      const result = resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      expect(result.description).toBe("Reads a file");
      expect(result.inputSchema).toEqual(tool.inputSchema);
    });

    it("should not add hash metadata in NEVER mode", () => {
      const tool = createTool({ name: "read_file" });
      const result = resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      expect(result._meta?.originalName).toBeUndefined();
      expect(result._meta?.hashAlgorithm).toBeUndefined();
    });

    it("should hash tool name in ALWAYS mode", () => {
      resolver.setHashMode(ToolNameHashMode.ALWAYS);
      const tool = createTool({ name: "read_file" });
      const result = resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      expect(result.name).toHaveLength(12);
      expect(result.name).not.toContain("__");
      expect(result.title).toBe("github__read_file");
      expect(result._meta?.originalName).toBe("read_file");
      expect(result._meta?.namespace).toBe(NAMESPACE_GITHUB);
      expect(result._meta?.hashAlgorithm).toBe("sha256");
    });

    it("should produce deterministic hashes for the same input", () => {
      resolver.setHashMode(ToolNameHashMode.ALWAYS);
      const tool = createTool({ name: "read_file" });

      const result1 = resolver.namespaceTool(NAMESPACE_GITHUB, tool);
      const result2 = resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      expect(result1.name).toBe(result2.name);
    });

    it("should produce different hashes for different namespaces", () => {
      resolver.setHashMode(ToolNameHashMode.ALWAYS);
      const tool = createTool({ name: "read_file" });

      const result1 = resolver.namespaceTool(NAMESPACE_GITHUB, tool);
      resolver.clearLookupTable();
      const result2 = resolver.namespaceTool(NAMESPACE_NOTION, tool);

      expect(result1.name).not.toBe(result2.name);
    });

    it("should hash only long names in THRESHOLD mode (default threshold 64)", () => {
      resolver = new NamespaceResolver("__", ToolNameHashMode.THRESHOLD, 64);

      const shortTool = createTool({ name: "read" });
      const shortResult = resolver.namespaceTool(NAMESPACE_GITHUB, shortTool);
      expect(shortResult.name).toBe("github__read");

      const longTool = createTool({ name: "a_very_long_tool_name_that_exceeds_the_threshold_limit_for_hashing" });
      const longResult = resolver.namespaceTool(NAMESPACE_GITHUB, longTool);
      expect(longResult.name).toHaveLength(12);
      expect(longResult._meta?.originalName).toBe(longTool.name);
    });
  });

  describe("namespaceResource", () => {
    it("should append namespace query param to absolute URL", () => {
      const resource = createResource({ uri: "https://api.example.com/files/readme.md" });
      const result = resolver.namespaceResource(NAMESPACE_GITHUB, resource);

      const url = new URL(result.uri);
      expect(url.searchParams.get("namespace")).toBe(NAMESPACE_GITHUB);
    });

    it("should preserve existing query params", () => {
      const resource = createResource({ uri: "https://api.example.com/files?format=json" });
      const result = resolver.namespaceResource(NAMESPACE_GITHUB, resource);

      const url = new URL(result.uri);
      expect(url.searchParams.get("format")).toBe("json");
      expect(url.searchParams.get("namespace")).toBe(NAMESPACE_GITHUB);
    });

    it("should use fallback for relative/invalid URLs", () => {
      const resource = createResource({ uri: "relative/path/file.md" });
      const result = resolver.namespaceResource(NAMESPACE_GITHUB, resource);

      expect(result.uri).toContain("namespace=github");
    });

    it("should preserve other resource properties", () => {
      const resource = createResource({ name: "my-resource", description: "test" });
      const result = resolver.namespaceResource(NAMESPACE_GITHUB, resource);

      expect(result.name).toBe("my-resource");
      expect(result.description).toBe("test");
    });
  });

  describe("namespaceResourceTemplate", () => {
    it("should append namespace query param to template URI", () => {
      const template = createResourceTemplate({ uriTemplate: "https://api.example.com/files/{path}" });
      const result = resolver.namespaceResourceTemplate(NAMESPACE_GITHUB, template);

      expect(result.uriTemplate).toContain("namespace=github");
    });

    it("should use fallback for relative template URIs", () => {
      const template = createResourceTemplate({ uriTemplate: "relative/{path}" });
      const result = resolver.namespaceResourceTemplate(NAMESPACE_GITHUB, template);

      expect(result.uriTemplate).toContain("namespace=github");
    });
  });

  describe("namespacePrompt", () => {
    it("should prefix prompt name with namespace", () => {
      const prompt = createPrompt({ name: "summarize" });
      const result = resolver.namespacePrompt(NAMESPACE_GITHUB, prompt);

      expect(result.name).toBe("github__summarize");
    });

    it("should preserve other prompt properties", () => {
      const prompt = createPrompt({ name: "summarize", description: "Summarizes content" });
      const result = resolver.namespacePrompt(NAMESPACE_GITHUB, prompt);

      expect(result.description).toBe("Summarizes content");
    });
  });

  describe("extractNamespaceFromName", () => {
    it("should parse namespace__name format", () => {
      const { namespace, address } = resolver.extractNamespaceFromName("github__read_file");

      expect(namespace).toBe("github");
      expect(address).toBe("read_file");
    });

    it("should handle names with multiple separators", () => {
      const { namespace, address } = resolver.extractNamespaceFromName("github__some__nested__name");

      expect(namespace).toBe("github");
      expect(address).toBe("some__nested__name");
    });

    it("should resolve hashed names from lookup table", () => {
      resolver.setHashMode(ToolNameHashMode.ALWAYS);
      const tool = createTool({ name: "read_file" });
      const namespacedTool = resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      const { namespace, address } = resolver.extractNamespaceFromName(namespacedTool.name);

      expect(namespace).toBe(NAMESPACE_GITHUB);
      expect(address).toBe("read_file");
    });

    it("should throw on name without separator", () => {
      expect(() => resolver.extractNamespaceFromName("noseparator")).toThrow();
    });
  });

  describe("extractNamespaceFromUri", () => {
    it("should extract namespace query param from URI", () => {
      const { namespace, address } = resolver.extractNamespaceFromUri(
        "https://api.example.com/files?namespace=github"
      );

      expect(namespace).toBe("github");
      expect(address).not.toContain("namespace=github");
    });

    it("should return undefined namespace when not present", () => {
      const { namespace, address } = resolver.extractNamespaceFromUri(
        "https://api.example.com/files"
      );

      expect(namespace).toBeUndefined();
      expect(address).toContain("api.example.com");
    });

    it("should handle plain strings without namespace param", () => {
      const { namespace, address } = resolver.extractNamespaceFromUri("/simple/path");

      expect(namespace).toBeUndefined();
      expect(address).toContain("/simple/path");
    });
  });

  describe("hash mode management", () => {
    it("should return current hash mode", () => {
      expect(resolver.getHashMode()).toBe(ToolNameHashMode.NEVER);
    });

    it("should update hash mode and clear lookup table", () => {
      resolver.setHashMode(ToolNameHashMode.ALWAYS);
      const tool = createTool({ name: "test" });
      resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      resolver.setHashMode(ToolNameHashMode.NEVER);
      expect(resolver.getHashMode()).toBe(ToolNameHashMode.NEVER);
    });

    it("should clear lookup table on mode change", () => {
      resolver.setHashMode(ToolNameHashMode.ALWAYS);
      const tool = createTool({ name: "test_tool" });
      const hashed = resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      resolver.setHashMode(ToolNameHashMode.NEVER);

      expect(() => resolver.extractNamespaceFromName(hashed.name)).toThrow();
    });
  });

  describe("clearLookupTable", () => {
    it("should clear stored hash mappings", () => {
      resolver.setHashMode(ToolNameHashMode.ALWAYS);
      const tool = createTool({ name: "test_tool" });
      const hashed = resolver.namespaceTool(NAMESPACE_GITHUB, tool);

      resolver.clearLookupTable();

      expect(() => resolver.extractNamespaceFromName(hashed.name)).toThrow();
    });
  });

  describe("namespaceTool with _meta.ui", () => {
    it("namespaces resourceUri inside _meta.ui", () => {
      const tool = createTool({
        name: "open_file",
        _meta: { ui: { resourceUri: "https://example.com/res", label: "Open" } } as any,
      });
      const result = resolver.namespaceTool(NAMESPACE_GITHUB, tool);
      const ui = (result._meta as any).ui;
      expect(ui.resourceUri).toContain("namespace=github");
      expect(ui.label).toBe("Open");
    });

    it("preserves other _meta.ui fields alongside the namespaced resourceUri", () => {
      const tool = createTool({
        name: "view",
        _meta: { ui: { resourceUri: "https://api.example.com/res", icon: "eye", badge: 3 } } as any,
      });
      const result = resolver.namespaceTool(NAMESPACE_GITHUB, tool);
      const ui = (result._meta as any).ui;
      expect(ui.icon).toBe("eye");
      expect(ui.badge).toBe(3);
      expect(ui.resourceUri).toContain("namespace=github");
    });

    it("handles _meta.ui without resourceUri - no namespacing applied to it", () => {
      const tool = createTool({ name: "list", _meta: { ui: { icon: "list" } } as any });
      const result = resolver.namespaceTool(NAMESPACE_GITHUB, tool);
      expect((result._meta as any).ui.icon).toBe("list");
      expect((result._meta as any).ui.resourceUri).toBeUndefined();
    });

    it("tool with no _meta.ui produces no ui in result", () => {
      const tool = createTool({ name: "plain" });
      const result = resolver.namespaceTool(NAMESPACE_GITHUB, tool);
      expect((result._meta as any)?.ui).toBeUndefined();
    });
  });

  describe("THRESHOLD mode - boundary", () => {
    it("does not hash a name exactly at the threshold", () => {
      const threshold = 64;
      const r = new NamespaceResolver("__", ToolNameHashMode.THRESHOLD, threshold);
      const toolName = "a".repeat(threshold - "ns".length - "__".length);
      const result = r.namespaceTool("ns", createTool({ name: toolName }));
      expect(result.name).toBe(`ns__${toolName}`);
    });

    it("hashes a name one character over the threshold", () => {
      const threshold = 64;
      const r = new NamespaceResolver("__", ToolNameHashMode.THRESHOLD, threshold);
      const toolName = "a".repeat(threshold - "ns".length - "__".length + 1);
      const result = r.namespaceTool("ns", createTool({ name: toolName }));
      expect(result.name).toHaveLength(12);
    });
  });

  describe("custom separator", () => {
    it("uses the custom separator for namespacing", () => {
      const r = new NamespaceResolver("::", ToolNameHashMode.NEVER);
      expect(r.namespaceTool("db", createTool({ name: "query" })).name).toBe("db::query");
    });

    it("extracts namespace using custom separator", () => {
      const r = new NamespaceResolver("::", ToolNameHashMode.NEVER);
      const { namespace, address } = r.extractNamespaceFromName("db::query");
      expect(namespace).toBe("db");
      expect(address).toBe("query");
    });
  });

  describe("extractNamespaceFromUri - multiple query params", () => {
    it("preserves other query params when removing namespace", () => {
      const { namespace, address } = resolver.extractNamespaceFromUri(
        "https://api.example.com/res?format=json&namespace=stripe&version=2"
      );
      expect(namespace).toBe("stripe");
      expect(address).toContain("format=json");
      expect(address).toContain("version=2");
      expect(address).not.toContain("namespace=stripe");
    });
  });
});
