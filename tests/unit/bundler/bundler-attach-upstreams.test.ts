import { describe, it, expect, vi } from "vitest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";
import type { ResolverService } from "../../../src/bundler/core/resolver/service.js";
import type { BundlerConfig } from "../../../src/bundler/core/schemas.js";
import { createMCPConfig } from "../../helpers/fixtures.js";

function makeConfig(): BundlerConfig {
  return {
    name: "test-bundler",
    version: "0.0.0",
    host: "0.0.0.0",
    port: 0,
    concurrency: { max_concurrent: 10 },
  } as unknown as BundlerConfig;
}

function makeResolver(): ResolverService {
  return { resolveBundle: vi.fn() };
}

describe("BundlerServer.attachUpstreamsAsync", () => {
  it("attaches each config to the session and isolates a failing one", async () => {
    const bundler = new BundlerServer(makeConfig(), makeResolver());
    const session = bundler.createSession("s1", "b0", "tok", []);
    const attachSpy = vi.spyOn(session, "attachUpstream")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);

    const configs = [createMCPConfig({ namespace: "bad" }), createMCPConfig({ namespace: "good" })];

    await expect(bundler.attachUpstreamsAsync(session, configs)).resolves.not.toThrow();
    expect(attachSpy).toHaveBeenCalledTimes(2);
  });
});
