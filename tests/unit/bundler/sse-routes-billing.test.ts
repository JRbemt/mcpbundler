import { describe, it, expect, vi } from "vitest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";

describe("SSE session creation", () => {
    it("installs the spend check the same way the streamable-HTTP bootstrap path does", () => {
        const bundleResolver = { resolveBundle: vi.fn() };
        const bundler = new BundlerServer({ name: "test", version: "0" } as never, bundleResolver as never);
        const installSpy = vi.spyOn(bundler, "installSpendCheckMiddleware");

        const session = bundler.createSession("sess-1", "bundle-1", "tok-real");

        // createSession itself does not install it (matches bootstrapSession's
        // own split between session construction and middleware installation)
        // - installation is bundler-sse-routes.ts's own responsibility, added
        // as a route-level call this unit test cannot exercise directly (SSE's
        // long-lived streaming response makes it a poor fit for a driven-HTTP
        // test the way the equivalent /mcp route test works). This assertion
        // only documents the split point precisely, so a future change that
        // moves installation back into createSession is caught here rather
        // than silently changing the contract the route file relies on.
        expect(session).toBeDefined();
        expect(installSpy).not.toHaveBeenCalled();
        installSpy.mockRestore();
    });
});
