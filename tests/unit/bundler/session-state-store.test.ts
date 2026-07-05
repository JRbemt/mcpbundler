import { describe, it, expect } from "vitest";
import { InMemorySessionStateStore } from "../../../src/bundler/core/session/session-state-store.js";

describe("InMemorySessionStateStore", () => {
    it("returns undefined for a key that was never set", async () => {
        const store = new InMemorySessionStateStore();
        expect(await store.get("s1", "missing")).toBeUndefined();
    });

    it("round-trips a value through set/get", async () => {
        const store = new InMemorySessionStateStore();
        await store.set("s1", "callHistory", ["a", "b"]);
        expect(await store.get("s1", "callHistory")).toEqual(["a", "b"]);
    });

    it("overwrites a value on repeated set", async () => {
        const store = new InMemorySessionStateStore();
        await store.set("s1", "count", 1);
        await store.set("s1", "count", 2);
        expect(await store.get("s1", "count")).toBe(2);
    });

    it("isolates state between different session ids", async () => {
        const store = new InMemorySessionStateStore();
        await store.set("s1", "context", "task-a");
        await store.set("s2", "context", "task-b");
        expect(await store.get("s1", "context")).toBe("task-a");
        expect(await store.get("s2", "context")).toBe("task-b");
    });

    it("deletes a single key without affecting others in the same session", async () => {
        const store = new InMemorySessionStateStore();
        await store.set("s1", "a", 1);
        await store.set("s1", "b", 2);
        await store.delete("s1", "a");
        expect(await store.get("s1", "a")).toBeUndefined();
        expect(await store.get("s1", "b")).toBe(2);
    });

    it("deletes all keys for a session when no key is given", async () => {
        const store = new InMemorySessionStateStore();
        await store.set("s1", "a", 1);
        await store.set("s1", "b", 2);
        await store.delete("s1");
        expect(await store.get("s1", "a")).toBeUndefined();
        expect(await store.get("s1", "b")).toBeUndefined();
    });
});
