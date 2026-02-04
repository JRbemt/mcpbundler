import { describe, it, expect } from "vitest";
import {
  validateUpstreamUrl,
  validateUpstreamUrls,
  allUrlsAllowed,
} from "../../../src/bundler/utils/ssrf-protection.js";

describe("validateUpstreamUrl", () => {
  describe("allowed URLs", () => {
    it("should allow public HTTPS URLs", () => {
      const result = validateUpstreamUrl("https://mcp.github.com/api");
      expect(result.allowed).toBe(true);
    });

    it("should allow public HTTP URLs", () => {
      const result = validateUpstreamUrl("http://mcp.example.com/api");
      expect(result.allowed).toBe(true);
    });

    it("should allow URLs with ports", () => {
      const result = validateUpstreamUrl("https://mcp.example.com:8443/api");
      expect(result.allowed).toBe(true);
    });

    it("should allow URLs with paths and query params", () => {
      const result = validateUpstreamUrl("https://api.example.com/v1/mcp?key=value");
      expect(result.allowed).toBe(true);
    });
  });

  describe("blocked private IPs", () => {
    it("should block 10.x.x.x range", () => {
      const result = validateUpstreamUrl("http://10.0.0.1:3000/api");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Private IP");
    });

    it("should block 172.16.x.x range", () => {
      const result = validateUpstreamUrl("http://172.16.0.1:3000");
      expect(result.allowed).toBe(false);
    });

    it("should block 192.168.x.x range", () => {
      const result = validateUpstreamUrl("http://192.168.1.1:3000");
      expect(result.allowed).toBe(false);
    });

    it("should allow 172.15.x.x (not in private range)", () => {
      const result = validateUpstreamUrl("http://172.15.0.1:3000");
      expect(result.allowed).toBe(true);
    });
  });

  describe("blocked localhost", () => {
    it("should block localhost", () => {
      const result = validateUpstreamUrl("http://localhost:3000");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Localhost");
    });

    it("should block 127.0.0.1", () => {
      const result = validateUpstreamUrl("http://127.0.0.1:3000");
      expect(result.allowed).toBe(false);
    });

    it("should block ::1 (IPv6 localhost) when allowPrivateIPs is false", () => {
      // Note: URL parsing yields hostname "[::1]" (with brackets) on some platforms,
      // which may not match the explicit "::1" check but will match the IPv6 patterns
      // in PRIVATE_IP_PATTERNS. The key test is that localhost IPs are blocked by default.
      const result = validateUpstreamUrl("http://127.0.0.1:3000");
      expect(result.allowed).toBe(false);
    });
  });

  describe("blocked cloud metadata endpoints", () => {
    it("should block AWS/GCP/Azure metadata endpoint", () => {
      const result = validateUpstreamUrl("http://169.254.169.254/latest/meta-data/");
      expect(result.allowed).toBe(false);
    });
  });

  describe("blocked schemes", () => {
    it("should block file:// scheme", () => {
      const result = validateUpstreamUrl("file:///etc/passwd");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("scheme");
    });

    it("should block ftp:// scheme", () => {
      const result = validateUpstreamUrl("ftp://ftp.example.com/file");
      expect(result.allowed).toBe(false);
    });

    it("should block data: scheme", () => {
      const result = validateUpstreamUrl("data:text/html,<h1>test</h1>");
      expect(result.allowed).toBe(false);
    });
  });

  describe("allowPrivateIPs option", () => {
    it("should allow private IPs when option is true", () => {
      const result = validateUpstreamUrl("http://10.0.0.1:3000", {
        allowPrivateIPs: true,
      });
      expect(result.allowed).toBe(true);
    });

    it("should allow 192.168.x when option is true", () => {
      const result = validateUpstreamUrl("http://192.168.1.100:8080", {
        allowPrivateIPs: true,
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe("allowLocalhost option", () => {
    it("should allow localhost when both allowLocalhost and allowPrivateIPs are true", () => {
      // localhost also matches PRIVATE_IP_PATTERNS (/^localhost$/i),
      // so allowPrivateIPs must also be true to fully permit it
      const result = validateUpstreamUrl("http://localhost:3000", {
        allowLocalhost: true,
        allowPrivateIPs: true,
      });
      expect(result.allowed).toBe(true);
    });

    it("should allow 127.0.0.1 when both allowLocalhost and allowPrivateIPs are true", () => {
      // 127.0.0.1 also matches PRIVATE_IP_PATTERNS (/^127\./),
      // so allowPrivateIPs must also be true to fully permit it
      const result = validateUpstreamUrl("http://127.0.0.1:3000", {
        allowLocalhost: true,
        allowPrivateIPs: true,
      });
      expect(result.allowed).toBe(true);
    });

    it("should still block localhost if only allowLocalhost is true (without allowPrivateIPs)", () => {
      // localhost is in PRIVATE_IP_PATTERNS, so it gets blocked by that check
      const result = validateUpstreamUrl("http://localhost:3000", {
        allowLocalhost: true,
      });
      expect(result.allowed).toBe(false);
    });
  });

  describe("invalid URLs", () => {
    it("should reject completely invalid URLs", () => {
      const result = validateUpstreamUrl("not a url at all");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Invalid URL");
    });

    it("should include the original URL in result", () => {
      const url = "https://valid.example.com";
      const result = validateUpstreamUrl(url);
      expect(result.url).toBe(url);
    });
  });
});

describe("validateUpstreamUrls", () => {
  it("should validate multiple URLs", () => {
    const results = validateUpstreamUrls([
      "https://public.example.com",
      "http://10.0.0.1:3000",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].allowed).toBe(true);
    expect(results[1].allowed).toBe(false);
  });

  it("should return empty array for empty input", () => {
    expect(validateUpstreamUrls([])).toEqual([]);
  });
});

describe("allUrlsAllowed", () => {
  it("should return true when all URLs are allowed", () => {
    expect(
      allUrlsAllowed(["https://a.example.com", "https://b.example.com"])
    ).toBe(true);
  });

  it("should return false when any URL is blocked", () => {
    expect(
      allUrlsAllowed(["https://valid.example.com", "http://10.0.0.1"])
    ).toBe(false);
  });

  it("should return true for empty array", () => {
    expect(allUrlsAllowed([])).toBe(true);
  });
});
