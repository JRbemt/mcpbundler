import { describe, it, expect, vi } from "vitest";
import { AbstractBundlerMiddleware, MiddlewareContext } from "../../../src/bundler/core/middleware/middleware.js";
import type { Tool, Resource, Prompt, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createTool, createResource, createPrompt } from "../../helpers/fixtures.js";

class ConcreteMiddleware extends AbstractBundlerMiddleware {
  readonly name = "concrete";
}

function makeCtx(): MiddlewareContext {
  return {
    sessionId: "sess-1",
    bundleId: "bundle-1",
    notifyToolsChanged: vi.fn(),
    notifyResourcesChanged: vi.fn(),
    notifyPromptsChanged: vi.fn(),
    attachUpstream: vi.fn(),
    detachUpstream: vi.fn(),
    getAttachedNamespaces: vi.fn().mockReturnValue([]),
    getAvailableUpstreams: vi.fn().mockReturnValue([]),
  };
}

describe("AbstractBundlerMiddleware defaults", () => {
  const mw = new ConcreteMiddleware();
  const ctx = makeCtx();

  it("transformToolList passes tools through unchanged", async () => {
    const tools: Tool[] = [createTool({ name: "read_file" }), createTool({ name: "write_file" })];
    const result = await mw.transformToolList(tools, ctx);
    expect(result).toEqual(tools);
  });

  it("transformResourceList passes resources through unchanged", async () => {
    const resources: Resource[] = [createResource({ uri: "https://example.com/a" })];
    const result = await mw.transformResourceList(resources, ctx);
    expect(result).toEqual(resources);
  });

  it("transformPromptList passes prompts through unchanged", async () => {
    const prompts: Prompt[] = [createPrompt({ name: "summarize" })];
    const result = await mw.transformPromptList(prompts, ctx);
    expect(result).toEqual(prompts);
  });

  it("handleOwnToolCall returns null", async () => {
    const result = await mw.handleOwnToolCall({ name: "any_tool", arguments: {} }, ctx);
    expect(result).toBeNull();
  });

  it("onBeforeToolCall resolves without error", async () => {
    await expect(mw.onBeforeToolCall({ name: "any_tool", arguments: {} }, ctx)).resolves.toBeUndefined();
  });

  it("onAfterToolCall returns the result unchanged", async () => {
    const result: CallToolResult = { content: [{ type: "text", text: "done" }] };
    const returned = await mw.onAfterToolCall({ name: "any_tool", arguments: {} }, result, ctx);
    expect(returned).toEqual(result);
  });

  it("onUpstreamAttached resolves without error", async () => {
    await expect(mw.onUpstreamAttached("github", ctx)).resolves.toBeUndefined();
  });

  it("teardown resolves without error", async () => {
    await expect(mw.teardown()).resolves.toBeUndefined();
  });

  it("transformToolList with empty list returns empty list", async () => {
    expect(await mw.transformToolList([], ctx)).toEqual([]);
  });

  it("transformResourceList with empty list returns empty list", async () => {
    expect(await mw.transformResourceList([], ctx)).toEqual([]);
  });

  it("onAfterToolCall with isError result passes it through", async () => {
    const result: CallToolResult = { content: [{ type: "text", text: "error" }], isError: true };
    const returned = await mw.onAfterToolCall({ name: "any_tool", arguments: {} }, result, ctx);
    expect(returned.isError).toBe(true);
  });
});
