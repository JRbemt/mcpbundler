import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SessionActivityMonitor,
  IDLE_TIMEOUT_EVENT,
} from "../../../src/bundler/core/session/session-activity-monitor.js";

describe("SessionActivityMonitor", () => {
  let monitor: SessionActivityMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = new SessionActivityMonitor("test-session", 5000, 1000);
  });

  afterEach(() => {
    monitor.stopMonitoring();
    vi.useRealTimers();
  });

  describe("touch", () => {
    it("should update last activity timestamp", () => {
      const before = monitor.getTimeSinceLastActivity();
      vi.advanceTimersByTime(2000);
      expect(monitor.getTimeSinceLastActivity()).toBeGreaterThanOrEqual(2000);

      monitor.touch();
      expect(monitor.getTimeSinceLastActivity()).toBeLessThan(100);
    });
  });

  describe("getTimeSinceLastActivity", () => {
    it("should return elapsed time since construction", () => {
      expect(monitor.getTimeSinceLastActivity()).toBeLessThan(100);

      vi.advanceTimersByTime(3000);
      expect(monitor.getTimeSinceLastActivity()).toBeGreaterThanOrEqual(3000);
    });

    it("should reset after touch", () => {
      vi.advanceTimersByTime(3000);
      monitor.touch();
      expect(monitor.getTimeSinceLastActivity()).toBeLessThan(100);
    });
  });

  describe("startMonitoring / stopMonitoring", () => {
    it("should start and stop monitoring", () => {
      expect(monitor.isMonitoring()).toBe(false);

      monitor.startMonitoring();
      expect(monitor.isMonitoring()).toBe(true);

      monitor.stopMonitoring();
      expect(monitor.isMonitoring()).toBe(false);
    });

    it("should be idempotent on double start", () => {
      monitor.startMonitoring();
      monitor.startMonitoring();
      expect(monitor.isMonitoring()).toBe(true);
    });

    it("should be safe to stop when not monitoring", () => {
      expect(() => monitor.stopMonitoring()).not.toThrow();
    });
  });

  describe("idle timeout detection", () => {
    it("should emit idle_timeout when idle exceeds threshold", () => {
      const handler = vi.fn();
      monitor.on(IDLE_TIMEOUT_EVENT, handler);

      monitor.startMonitoring();

      // Advance past idle timeout (5000ms) + check interval (1000ms)
      vi.advanceTimersByTime(6000);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "test-session",
          idleTimeMs: expect.any(Number),
        })
      );
    });

    it("should not emit idle_timeout when activity is recent", () => {
      const handler = vi.fn();
      monitor.on(IDLE_TIMEOUT_EVENT, handler);

      monitor.startMonitoring();

      // Touch before each check interval
      vi.advanceTimersByTime(900);
      monitor.touch();
      vi.advanceTimersByTime(900);
      monitor.touch();
      vi.advanceTimersByTime(900);
      monitor.touch();

      expect(handler).not.toHaveBeenCalled();
    });

    it("should not emit after monitoring is stopped", () => {
      const handler = vi.fn();
      monitor.on(IDLE_TIMEOUT_EVENT, handler);

      monitor.startMonitoring();
      vi.advanceTimersByTime(2000);
      monitor.stopMonitoring();

      // Advance well past the idle timeout
      vi.advanceTimersByTime(10000);

      expect(handler).not.toHaveBeenCalled();
    });

    it("should emit multiple times if session stays idle", () => {
      const handler = vi.fn();
      monitor.on(IDLE_TIMEOUT_EVENT, handler);

      monitor.startMonitoring();

      // Advance multiple check intervals past the idle timeout
      vi.advanceTimersByTime(8000);

      expect(handler.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("isMonitoring", () => {
    it("should return false initially", () => {
      expect(monitor.isMonitoring()).toBe(false);
    });

    it("should return true when monitoring", () => {
      monitor.startMonitoring();
      expect(monitor.isMonitoring()).toBe(true);
    });

    it("should return false after stop", () => {
      monitor.startMonitoring();
      monitor.stopMonitoring();
      expect(monitor.isMonitoring()).toBe(false);
    });
  });
});
