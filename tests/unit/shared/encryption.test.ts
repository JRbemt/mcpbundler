import { describe, it, expect, beforeEach } from "vitest";
import {
  encrypt,
  decrypt,
  isEncrypted,
  encryptJSON,
  decryptJSON,
  generateApiKey,
  hashApiKey,
  isValidApiKeyFormat,
  API_KEY_PREFIX,
} from "../../../src/shared/utils/encryption.js";

describe("encrypt / decrypt", () => {
  it("should roundtrip plaintext", () => {
    const plaintext = "sensitive-credential-value";
    const encrypted = encrypt(plaintext);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("should produce different ciphertext for same input (random IV)", () => {
    const plaintext = "same-input";
    const enc1 = encrypt(plaintext);
    const enc2 = encrypt(plaintext);

    expect(enc1).not.toBe(enc2);
  });

  it("should handle empty string", () => {
    const encrypted = encrypt("");
    expect(decrypt(encrypted)).toBe("");
  });

  it("should handle unicode content", () => {
    const plaintext = "Hello, world! Cafe";
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("should handle long content", () => {
    const plaintext = "x".repeat(10000);
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("should throw on tampered ciphertext", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    parts[2] = "0".repeat(parts[2].length);
    const tampered = parts.join(":");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("should throw on invalid format", () => {
    expect(() => decrypt("not:valid")).toThrow();
    expect(() => decrypt("single-part")).toThrow();
  });
});

describe("isEncrypted", () => {
  it("should detect valid encrypted format", () => {
    const encrypted = encrypt("test-data");
    expect(isEncrypted(encrypted)).toBe(true);
  });

  it("should reject plaintext", () => {
    expect(isEncrypted("just-a-string")).toBe(false);
  });

  it("should reject empty string", () => {
    expect(isEncrypted("")).toBe(false);
  });

  it("should reject wrong number of parts", () => {
    expect(isEncrypted("part1:part2")).toBe(false);
    expect(isEncrypted("part1:part2:part3:part4")).toBe(false);
  });

  it("should reject non-hex parts", () => {
    expect(isEncrypted("zzzz:zzzz:zzzz")).toBe(false);
  });

  it("should reject incorrect IV length", () => {
    expect(isEncrypted("abcd:0123456789abcdef0123456789abcdef:aabbcc")).toBe(false);
  });
});

describe("encryptJSON / decryptJSON", () => {
  it("should roundtrip objects", () => {
    const data = { username: "admin", password: "secret123" };
    const encrypted = encryptJSON(data);
    const decrypted = decryptJSON<typeof data>(encrypted);

    expect(decrypted).toEqual(data);
  });

  it("should roundtrip arrays", () => {
    const data = [1, 2, 3, "test"];
    const encrypted = encryptJSON(data);
    const decrypted = decryptJSON<typeof data>(encrypted);

    expect(decrypted).toEqual(data);
  });

  it("should roundtrip nested structures", () => {
    const data = {
      auth: { method: "bearer", token: "abc123" },
      tags: ["production", "v2"],
    };
    const encrypted = encryptJSON(data);
    const decrypted = decryptJSON<typeof data>(encrypted);

    expect(decrypted).toEqual(data);
  });
});

describe("generateApiKey", () => {
  it("should produce key with mcpb_ prefix", () => {
    const key = generateApiKey();
    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("should produce unique keys", () => {
    const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
    expect(keys.size).toBe(100);
  });

  it("should produce keys of consistent length", () => {
    const key1 = generateApiKey();
    const key2 = generateApiKey();
    expect(key1.length).toBe(key2.length);
  });
});

describe("hashApiKey", () => {
  it("should produce deterministic hash", () => {
    const key = "mcpb_test_key_12345";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("should produce different hashes for different keys", () => {
    expect(hashApiKey("mcpb_key_a")).not.toBe(hashApiKey("mcpb_key_b"));
  });

  it("should produce 64-character hex string (SHA-256)", () => {
    const hash = hashApiKey("mcpb_test_key");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });
});

describe("isValidApiKeyFormat", () => {
  it("should accept valid API key format", () => {
    const key = generateApiKey();
    expect(isValidApiKeyFormat(key)).toBe(true);
  });

  it("should reject key without prefix", () => {
    expect(isValidApiKeyFormat("invalid_key_without_prefix")).toBe(false);
  });

  it("should reject too-short key", () => {
    expect(isValidApiKeyFormat("mcpb_short")).toBe(false);
  });

  it("should accept key at minimum length", () => {
    const minKey = API_KEY_PREFIX + "a".repeat(32);
    expect(isValidApiKeyFormat(minKey)).toBe(true);
  });
});
