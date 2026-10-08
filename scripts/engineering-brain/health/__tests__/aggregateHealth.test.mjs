import { describe, expect, it } from "vitest";
import { aggregateHealth, HEALTH_STATES } from "../aggregateHealth.mjs";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");

const caps = [
  { id: "a", name: "A", monitoring_status: "covered", execution_path: "x", expected_cadence: "daily" },
  { id: "b", name: "B", monitoring_status: "partially-covered", monitoring_note: "note", execution_path: "y" },
  { id: "c", name: "C", monitoring_status: "uncovered", execution_path: "z" },
];

const freshRun = {
  generated_at: "2026-10-08T10:00:00.000Z",
  commit_sha: "abc123",
  extractor_version: "9",
};

describe("aggregateHealth", () => {
  it("aggregates coverage counts by monitoring status", () => {
    const h = aggregateHealth({ capabilities: caps, latestRun: freshRun, bugFixCount: 5, now: NOW });
    expect(h.runtimeCoverage.totalCapabilities).toBe(3);
    expect(h.runtimeCoverage.byMonitoringStatus).toEqual({
      covered: 1,
      "partially-covered": 1,
      uncovered: 1,
    });
    expect(h.runtimeCoverage.state).toBe("confirmed");
  });

  it("marks index stale when older than 36h", () => {
    const oldRun = { ...freshRun, generated_at: "2026-10-06T10:00:00.000Z" };
    const h = aggregateHealth({ capabilities: caps, latestRun: oldRun, bugFixCount: 5, now: NOW });
    expect(h.index.state).toBe("stale");
  });

  it("marks index unavailable when no run exists", () => {
    const h = aggregateHealth({ capabilities: caps, latestRun: null, bugFixCount: null, now: NOW });
    expect(h.index.state).toBe("unavailable");
    expect(h.index.generatedAt).toBeNull();
    expect(h.bugCatalog.state).toBe("unavailable");
  });

  it("never reports the watchdog as actively monitoring", () => {
    const h = aggregateHealth({ capabilities: caps, latestRun: freshRun, bugFixCount: 1, now: NOW });
    expect(h.watchdog.state).toBe("not-enabled");
    expect(h.watchdog.enabled).toBe(false);
    expect(h.watchdog.detail).toMatch(/not actively monitoring/i);
    expect(h.watchdog.detail).not.toMatch(/monitoring.*active/i);
  });

  it("handles empty capabilities without fabricating", () => {
    const h = aggregateHealth({ capabilities: [], latestRun: freshRun, bugFixCount: 0, now: NOW });
    expect(h.runtimeCoverage.state).toBe("unavailable");
    expect(h.runtimeCoverage.totalCapabilities).toBe(0);
  });

  it("exposes all documented health states", () => {
    expect(HEALTH_STATES).toEqual(
      expect.arrayContaining(["confirmed", "suspected", "unavailable", "stale", "not-enabled"]),
    );
  });
});
