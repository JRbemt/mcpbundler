import { describe, it, expect, vi, afterEach } from "vitest";
import { LedgerClient } from "../../../src/bundler/core/billing/ledger-client.js";

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as Response;
}

describe("LedgerClient.reconcile", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("posts consumed and the bearer token, returns the balance and rejected flag", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ balance: 42, rejected: false }));
        vi.stubGlobal("fetch", fetchMock);

        const client = new LedgerClient("http://backend.local");
        const result = await client.reconcile("tok-abc", 3);

        expect(result).toEqual({ balance: 42, rejected: false });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://backend.local/v1/bundler/ledger/reconcile",
            expect.objectContaining({
                method: "POST",
                headers: { Authorization: "Bearer tok-abc", "Content-Type": "application/json" },
                body: JSON.stringify({ consumed: 3 }),
            })
        );
    });

    it("surfaces rejected: true from the backend", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ balance: 0, rejected: true })));
        const client = new LedgerClient("http://backend.local");

        const result = await client.reconcile("tok-abc", 10);

        expect(result).toEqual({ balance: 0, rejected: true });
    });

    it("returns null when the backend is unreachable", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
        const client = new LedgerClient("http://backend.local");
        expect(await client.reconcile("tok-abc", 0)).toBeNull();
    });

    it("returns null on a non-2xx response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));
        const client = new LedgerClient("http://backend.local");
        expect(await client.reconcile("tok-abc", 0)).toBeNull();
    });

    it("returns null when the response body has no numeric balance", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ balance: "not-a-number", rejected: false })));
        const client = new LedgerClient("http://backend.local");
        expect(await client.reconcile("tok-abc", 0)).toBeNull();
    });

    it("returns null when the response body has no boolean rejected flag", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ balance: 42 })));
        const client = new LedgerClient("http://backend.local");
        expect(await client.reconcile("tok-abc", 0)).toBeNull();
    });

    it("returns null, rather than rejecting, when a 2xx response body is not valid JSON", async () => {
        // A caller in the fire-and-forget batch-flush chain has no .catch()
        // of its own - a rejection here (instead of a resolved null) would
        // surface as an unhandled promise rejection.
        const response = {
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError("Unexpected end of JSON input");
            },
        } as unknown as Response;
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
        const client = new LedgerClient("http://backend.local");

        await expect(client.reconcile("tok-abc", 0)).resolves.toBeNull();
    });
});
