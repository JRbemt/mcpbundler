import { describe, it, expect, vi } from "vitest";
import {
  attachUpstreamsConcurrently,
  attachStageUpstreams,
} from "../../../src/bundler/core/session/loading/attach-stage-upstreams.js";
import { LoadingStrategy } from "../../../src/bundler/core/session/loading/loading-strategy.js";
import type { Session } from "../../../src/bundler/core/session/session.js";
import { createMCPConfig } from "../../helpers/fixtures.js";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    attachUpstream: vi.fn().mockResolvedValue(undefined),
    emitListChanged: vi.fn(),
    ...overrides,
  } as unknown as Session;
}

describe("attachUpstreamsConcurrently", () => {
  it("attaches every config", async () => {
    const session = makeSession();
    const configs = [createMCPConfig({ namespace: "a" }), createMCPConfig({ namespace: "b" })];

    await attachUpstreamsConcurrently(session, configs);

    expect(session.attachUpstream).toHaveBeenCalledTimes(2);
    expect(session.attachUpstream).toHaveBeenCalledWith(configs[0]);
    expect(session.attachUpstream).toHaveBeenCalledWith(configs[1]);
  });

  it("isolates a failing attach from the others and does not throw", async () => {
    const attachUpstream = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const session = makeSession({ attachUpstream });
    const configs = [createMCPConfig({ namespace: "bad" }), createMCPConfig({ namespace: "good" })];

    await expect(attachUpstreamsConcurrently(session, configs)).resolves.not.toThrow();
    expect(attachUpstream).toHaveBeenCalledTimes(2);
  });
});

describe("attachStageUpstreams", () => {
  it("EAGER: awaits every attach, then emits list_changed once", async () => {
    const session = makeSession();
    const configs = [createMCPConfig({ namespace: "a" })];

    await attachStageUpstreams(session, configs, LoadingStrategy.EAGER);

    expect(session.attachUpstream).toHaveBeenCalledWith(configs[0]);
    expect(session.emitListChanged).toHaveBeenCalledOnce();
  });

  it("PROGRESSIVE: does not emit list_changed itself", async () => {
    const session = makeSession();
    const configs = [createMCPConfig({ namespace: "a" })];

    await attachStageUpstreams(session, configs, LoadingStrategy.PROGRESSIVE);

    expect(session.emitListChanged).not.toHaveBeenCalled();
  });

  it("PROGRESSIVE: resolves without waiting for the attach to settle", async () => {
    let releaseAttach!: () => void;
    const pending = new Promise<void>((resolve) => { releaseAttach = resolve; });
    let settled = false;
    pending.then(() => { settled = true; });
    const attachUpstream = vi.fn().mockReturnValue(pending);
    const session = makeSession({ attachUpstream });

    await attachStageUpstreams(session, [createMCPConfig({ namespace: "a" })], LoadingStrategy.PROGRESSIVE);

    expect(settled).toBe(false);
    releaseAttach();
  });
});
