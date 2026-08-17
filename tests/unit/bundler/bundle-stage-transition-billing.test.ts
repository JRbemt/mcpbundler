import { describe, it, expect, vi } from "vitest";
import { BundlerServer } from "../../../src/bundler/core/bundler.js";

describe("BundlerServer.transitionSessionToBundle", () => {
    it("installs the token spend check on the transitioned session when billing is enabled", async () => {
        const originalBackendUrl = process.env.BACKEND_URL;
        const originalBillingFlag = process.env.BUNDLER_TOKEN_BILLING_ENABLED;
        process.env.BACKEND_URL = "http://backend.local";
        process.env.BUNDLER_TOKEN_BILLING_ENABLED = "true";
        try {
            const bundleResolver = { resolveBundle: vi.fn().mockResolvedValue({ bundleId: "b1", upstreams: [] }) };
            const bundler = new BundlerServer({ name: "test", version: "0" } as never, bundleResolver as never);

            const session = bundler.createAnonymousSession("sess-1");
            bundler.addSession("sess-1", session);

            const installSpy = vi.spyOn(bundler, "installSpendCheckMiddleware");
            await (bundler as unknown as {
                transitionSessionToBundle(sessionId: string, bundleId: string, bundleAccessToken: string): Promise<void>;
            }).transitionSessionToBundle("sess-1", "b1", "tok-real");

            expect(installSpy).toHaveBeenCalledWith(session);
            expect(session.accessToken).toBe("tok-real");
        } finally {
            process.env.BACKEND_URL = originalBackendUrl;
            process.env.BUNDLER_TOKEN_BILLING_ENABLED = originalBillingFlag;
        }
    });
});
