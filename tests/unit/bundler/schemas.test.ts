import { describe, it, expect } from "vitest";
import {
  BundlerConfigSchema,
  MCPConfigSchema,
  Bundle,
} from "../../../src/bundler/core/schemas.js";
import {
  MCPAuthConfigSchema,
  McpPermissionsSchema,
} from "../../../src/shared/domain/entities.js";

describe("BundlerConfigSchema", () => {
  it("should parse valid config with all fields", () => {
    const config = BundlerConfigSchema.parse({
      name: "test-bundler",
      version: "1.0.0",
      host: "0.0.0.0",
      port: 3000,
      concurrency: {
        max_concurrent: 50,
        idle_timeout_ms: 60000,
      },
    });

    expect(config.name).toBe("test-bundler");
    expect(config.port).toBe(3000);
    expect(config.concurrency.max_concurrent).toBe(50);
  });

  it("should apply default concurrency values", () => {
    const config = BundlerConfigSchema.parse({
      name: "test",
      version: "1.0",
      host: "localhost",
      port: 8080,
    });

    expect(config.concurrency.max_concurrent).toBe(100);
    expect(config.concurrency.idle_timeout_ms).toBe(5 * 60 * 1000);
  });

  it("should reject missing required fields", () => {
    expect(() => BundlerConfigSchema.parse({})).toThrow();
    expect(() => BundlerConfigSchema.parse({ name: "test" })).toThrow();
  });
});

describe("MCPConfigSchema", () => {
  it("should parse valid MCP config", () => {
    const config = MCPConfigSchema.parse({
      namespace: "github",
      url: "https://mcp.github.com",
    });

    expect(config.namespace).toBe("github");
    expect(config.url).toBe("https://mcp.github.com");
    expect(config.authStrategy).toBe("MASTER");
    expect(config.stateless).toBe(false);
  });

  it("should accept valid namespace characters", () => {
    const validNamespaces = ["github", "my-mcp", "my.mcp", "my_mcp", "MCP123"];
    for (const ns of validNamespaces) {
      const config = MCPConfigSchema.parse({ namespace: ns, url: "https://example.com" });
      expect(config.namespace).toBe(ns);
    }
  });

  it("should reject namespace with consecutive underscores", () => {
    expect(() =>
      MCPConfigSchema.parse({ namespace: "my__mcp", url: "https://example.com" })
    ).toThrow();
  });

  it("should reject empty namespace", () => {
    expect(() =>
      MCPConfigSchema.parse({ namespace: "", url: "https://example.com" })
    ).toThrow();
  });

  it("should reject invalid URL", () => {
    expect(() =>
      MCPConfigSchema.parse({ namespace: "test", url: "not-a-url" })
    ).toThrow();
  });

  it("should accept all auth strategies", () => {
    for (const strategy of ["MASTER", "USER_SET", "NONE"]) {
      const config = MCPConfigSchema.parse({
        namespace: "test",
        url: "https://example.com",
        authStrategy: strategy,
      });
      expect(config.authStrategy).toBe(strategy);
    }
  });

  it("should accept optional permissions", () => {
    const config = MCPConfigSchema.parse({
      namespace: "test",
      url: "https://example.com",
      permissions: {
        allowedTools: ["read_file"],
        allowedResources: [],
        allowedPrompts: ["*"],
      },
    });

    expect(config.permissions?.allowedTools).toEqual(["read_file"]);
    expect(config.permissions?.allowedResources).toEqual([]);
    expect(config.permissions?.allowedPrompts).toEqual(["*"]);
  });
});

describe("MCPAuthConfigSchema", () => {
  it("should parse 'none' auth method", () => {
    const auth = MCPAuthConfigSchema.parse({ method: "none" });
    expect(auth.method).toBe("none");
  });

  it("should parse 'bearer' auth method", () => {
    const auth = MCPAuthConfigSchema.parse({ method: "bearer", token: "my-token" }) as { method: "bearer"; token: string };
    expect(auth.method).toBe("bearer");
    expect(auth.token).toBe("my-token");
  });

  it("should parse 'basic' auth method", () => {
    const auth = MCPAuthConfigSchema.parse({
      method: "basic",
      username: "user",
      password: "pass",
    }) as { method: "basic"; username: string; password: string };
    expect(auth.method).toBe("basic");
    expect(auth.username).toBe("user");
    expect(auth.password).toBe("pass");
  });

  it("should parse 'api_key' auth with default header", () => {
    const auth = MCPAuthConfigSchema.parse({ method: "api_key", key: "my-key" }) as { method: "api_key"; key: string; header: string };
    expect(auth.method).toBe("api_key");
    expect(auth.key).toBe("my-key");
    expect(auth.header).toBe("X-API-Key");
  });

  it("should parse 'api_key' auth with custom header", () => {
    const auth = MCPAuthConfigSchema.parse({
      method: "api_key",
      key: "my-key",
      header: "Authorization",
    }) as { method: "api_key"; key: string; header: string };
    expect(auth.header).toBe("Authorization");
  });

  it("should reject unknown auth method", () => {
    expect(() => MCPAuthConfigSchema.parse({ method: "oauth" })).toThrow();
  });

  it("should reject bearer without token", () => {
    expect(() => MCPAuthConfigSchema.parse({ method: "bearer" })).toThrow();
  });

  it("should reject basic without username or password", () => {
    expect(() => MCPAuthConfigSchema.parse({ method: "basic", username: "user" })).toThrow();
    expect(() => MCPAuthConfigSchema.parse({ method: "basic", password: "pass" })).toThrow();
  });
});

describe("McpPermissionsSchema", () => {
  it("should apply wildcard defaults", () => {
    const perms = McpPermissionsSchema.parse({});
    expect(perms.allowedTools).toEqual(["*"]);
    expect(perms.allowedResources).toEqual(["*"]);
    expect(perms.allowedPrompts).toEqual(["*"]);
  });

  it("should accept explicit values", () => {
    const perms = McpPermissionsSchema.parse({
      allowedTools: ["read_file", "write_file"],
      allowedResources: [],
      allowedPrompts: ["summarize"],
    });

    expect(perms.allowedTools).toEqual(["read_file", "write_file"]);
    expect(perms.allowedResources).toEqual([]);
    expect(perms.allowedPrompts).toEqual(["summarize"]);
  });
});

describe("Bundle schema", () => {
  it("should parse valid bundle", () => {
    const bundle = Bundle.parse({
      bundleId: "bundle-1",
      name: "My Bundle",
      upstreams: [
        { namespace: "github", url: "https://mcp.github.com" },
        { namespace: "notion", url: "https://mcp.notion.so" },
      ],
    });

    expect(bundle.bundleId).toBe("bundle-1");
    expect(bundle.name).toBe("My Bundle");
    expect(bundle.upstreams).toHaveLength(2);
  });

  it("should accept empty upstreams array", () => {
    const bundle = Bundle.parse({
      bundleId: "bundle-2",
      name: "Empty Bundle",
      upstreams: [],
    });
    expect(bundle.upstreams).toHaveLength(0);
  });

  it("should reject missing required fields", () => {
    expect(() => Bundle.parse({ name: "test" })).toThrow();
    expect(() => Bundle.parse({ bundleId: "id" })).toThrow();
  });
});
