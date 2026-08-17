import { afterEach, describe, expect, it, vi } from "vitest";

describe("logger transport selection", () => {
  const originalLogFormat = process.env.LOG_FORMAT;

  afterEach(() => {
    if (originalLogFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = originalLogFormat;
    vi.resetModules();
  });

  it("skips pino-pretty and uses pino's native transport when LOG_FORMAT=json", async () => {
    vi.resetModules();
    process.env.LOG_FORMAT = "json";
    const pinoModule = await import("pino");
    const transportSpy = vi.spyOn(pinoModule.default, "transport");
    await import("../../../src/shared/utils/logger.js");
    expect(transportSpy).not.toHaveBeenCalled();
  });

  it("keeps pino-pretty when LOG_FORMAT is unset (local dev default)", async () => {
    vi.resetModules();
    delete process.env.LOG_FORMAT;
    const pinoModule = await import("pino");
    const transportSpy = vi.spyOn(pinoModule.default, "transport");
    await import("../../../src/shared/utils/logger.js");
    expect(transportSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: "pino-pretty" })
    );
  });
});
