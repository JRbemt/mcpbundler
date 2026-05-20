import { describe, it, expect, beforeEach } from "vitest";
import {
  AllPassToolRouterLLM,
  getLLM,
  registerLLM,
  getRegisteredLLMNames,
  type LLMRouterTool,
} from "../../../src/bundler/core/middleware/llm-router/router-tool.js";
import { createMCPConfig } from "../../helpers/fixtures.js";

describe("AllPassToolRouterLLM", () => {
  const llm = new AllPassToolRouterLLM();

  it("returns all namespaces when count is within max", async () => {
    const upstreams = [createMCPConfig({ namespace: "a" }), createMCPConfig({ namespace: "b" })];
    const result = await llm.selectNamespaces("task", upstreams, 10);
    expect(result).toEqual(["a", "b"]);
  });

  it("respects maxUpstreams limit", async () => {
    const upstreams = [
      createMCPConfig({ namespace: "a" }),
      createMCPConfig({ namespace: "b" }),
      createMCPConfig({ namespace: "c" }),
    ];
    const result = await llm.selectNamespaces("task", upstreams, 2);
    expect(result).toEqual(["a", "b"]);
  });

  it("returns empty array for empty upstream list", async () => {
    const result = await llm.selectNamespaces("task", [], 10);
    expect(result).toEqual([]);
  });

  it("returns empty array when maxUpstreams is 0", async () => {
    const upstreams = [createMCPConfig({ namespace: "a" })];
    const result = await llm.selectNamespaces("task", upstreams, 0);
    expect(result).toEqual([]);
  });
});

describe("LLM registry", () => {
  it("getLLM returns allpass for unknown name", () => {
    const llm = getLLM("nonexistent-provider-xyz");
    expect(llm).toBeInstanceOf(AllPassToolRouterLLM);
  });

  it("getLLM returns allpass by name", () => {
    const llm = getLLM("allpass");
    expect(llm).toBeInstanceOf(AllPassToolRouterLLM);
  });

  it("registerLLM adds a custom implementation", async () => {
    const custom: LLMRouterTool = {
      selectNamespaces: async () => ["custom-ns"],
    };
    registerLLM("custom-test-provider", custom);

    const retrieved = getLLM("custom-test-provider");
    const result = await retrieved.selectNamespaces("ctx", [], 10);
    expect(result).toEqual(["custom-ns"]);
  });

  it("registerLLM overwrites an existing registration", async () => {
    const v1: LLMRouterTool = { selectNamespaces: async () => ["v1"] };
    const v2: LLMRouterTool = { selectNamespaces: async () => ["v2"] };

    registerLLM("overwrite-test", v1);
    registerLLM("overwrite-test", v2);

    const result = await getLLM("overwrite-test").selectNamespaces("", [], 10);
    expect(result).toEqual(["v2"]);
  });

  it("getRegisteredLLMNames includes allpass and any registered names", () => {
    registerLLM("names-test-provider", new AllPassToolRouterLLM());
    const names = getRegisteredLLMNames();
    expect(names).toContain("allpass");
    expect(names).toContain("names-test-provider");
  });
});
