import { describe, it, expect, vi } from "vitest";
import { PermissionManager } from "../../../src/bundler/core/session/permission-manager.js";
import {
  createMCPConfig,
  createMCPConfigWithWildcardPermissions,
  createMCPConfigWithEmptyPermissions,
  createMCPConfigWithSpecificPermissions,
} from "../../helpers/fixtures.js";

describe("PermissionManager", () => {
  const pm = new PermissionManager();

  describe("isToolAllowed", () => {
    it("should allow all tools when permissions are not set", () => {
      const config = createMCPConfig();
      expect(pm.isToolAllowed(config, "any_tool")).toBe(true);
    });

    it("should allow all tools with wildcard pattern", () => {
      const config = createMCPConfigWithWildcardPermissions();
      expect(pm.isToolAllowed(config, "read_file")).toBe(true);
      expect(pm.isToolAllowed(config, "write_file")).toBe(true);
    });

    it("should deny all tools with empty array", () => {
      const config = createMCPConfigWithEmptyPermissions();
      expect(pm.isToolAllowed(config, "read_file")).toBe(false);
      expect(pm.isToolAllowed(config, "any_tool")).toBe(false);
    });

    it("should allow exact name match", () => {
      const config = createMCPConfigWithSpecificPermissions(["read_file", "list_files"]);
      expect(pm.isToolAllowed(config, "read_file")).toBe(true);
      expect(pm.isToolAllowed(config, "list_files")).toBe(true);
      expect(pm.isToolAllowed(config, "delete_file")).toBe(false);
    });

    it("should support regex patterns", () => {
      const config = createMCPConfigWithSpecificPermissions(["^read_.*$"]);
      expect(pm.isToolAllowed(config, "read_file")).toBe(true);
      expect(pm.isToolAllowed(config, "read_directory")).toBe(true);
      expect(pm.isToolAllowed(config, "write_file")).toBe(false);
    });

    it("should handle invalid regex gracefully", () => {
      const config = createMCPConfigWithSpecificPermissions(["[invalid regex"]);
      expect(pm.isToolAllowed(config, "test")).toBe(false);
    });

    it("should match with multiple patterns", () => {
      const config = createMCPConfigWithSpecificPermissions(["read_file", "^write_.*$"]);
      expect(pm.isToolAllowed(config, "read_file")).toBe(true);
      expect(pm.isToolAllowed(config, "write_file")).toBe(true);
      expect(pm.isToolAllowed(config, "delete_file")).toBe(false);
    });
  });

  describe("isResourceAllowed", () => {
    it("should allow all resources when permissions are not set", () => {
      const config = createMCPConfig();
      expect(pm.isResourceAllowed(config, "any://resource")).toBe(true);
    });

    it("should allow all resources with wildcard pattern", () => {
      const config = createMCPConfigWithWildcardPermissions();
      expect(pm.isResourceAllowed(config, "https://api.example.com/data")).toBe(true);
    });

    it("should deny all resources with empty array", () => {
      const config = createMCPConfigWithEmptyPermissions();
      expect(pm.isResourceAllowed(config, "https://api.example.com/data")).toBe(false);
    });

    it("should allow exact URI match", () => {
      const config = createMCPConfigWithSpecificPermissions(
        ["*"],
        ["https://api.example.com/files"]
      );
      expect(pm.isResourceAllowed(config, "https://api.example.com/files")).toBe(true);
      expect(pm.isResourceAllowed(config, "https://api.example.com/other")).toBe(false);
    });

    it("should support regex patterns for resources", () => {
      const config = createMCPConfigWithSpecificPermissions(
        ["*"],
        ["^https://api\\.example\\.com/.*$"]
      );
      expect(pm.isResourceAllowed(config, "https://api.example.com/files")).toBe(true);
      expect(pm.isResourceAllowed(config, "https://other.com/files")).toBe(false);
    });
  });

  describe("isPromptAllowed", () => {
    it("should allow all prompts when permissions are not set", () => {
      const config = createMCPConfig();
      expect(pm.isPromptAllowed(config, "any_prompt")).toBe(true);
    });

    it("should allow all prompts with wildcard pattern", () => {
      const config = createMCPConfigWithWildcardPermissions();
      expect(pm.isPromptAllowed(config, "summarize")).toBe(true);
    });

    it("should deny all prompts with empty array", () => {
      const config = createMCPConfigWithEmptyPermissions();
      expect(pm.isPromptAllowed(config, "summarize")).toBe(false);
    });

    it("should allow exact name match for prompts", () => {
      const config = createMCPConfigWithSpecificPermissions(["*"], ["*"], ["summarize"]);
      expect(pm.isPromptAllowed(config, "summarize")).toBe(true);
      expect(pm.isPromptAllowed(config, "translate")).toBe(false);
    });
  });

  describe("logPermissionDenied", () => {
    it("should not throw when logging denial", () => {
      expect(() => {
        pm.logPermissionDenied("session-1", "tool", "github", "delete_repo");
      }).not.toThrow();
    });
  });
});
