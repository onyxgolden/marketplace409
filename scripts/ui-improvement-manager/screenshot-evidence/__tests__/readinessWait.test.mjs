import { describe, expect, it, vi } from "vitest";
import {
  READINESS_CONDITION_TYPES, ReadinessTimeoutError, buildReadinessPlan, waitForReadiness,
} from "../readinessWait.mjs";

const baseRoute = { routeId: "home", path: "/", readinessMarkers: [] };

describe("buildReadinessPlan", () => {
  it("always includes fonts and network-idle first, in that fixed order", () => {
    const plan = buildReadinessPlan(baseRoute);
    expect(plan[0].type).toBe(READINESS_CONDITION_TYPES.FONTS);
    expect(plan[1].type).toBe(READINESS_CONDITION_TYPES.NETWORK_IDLE);
  });

  it("appends route-declared markers after the two defaults, preserving declared order", () => {
    const route = {
      routeId: "x",
      readinessMarkers: [
        { type: READINESS_CONDITION_TYPES.NO_LOADING_STATUS },
        { type: READINESS_CONDITION_TYPES.CUSTOM_MARKER, selector: "[data-fb-ui-ready]" },
      ],
    };
    const plan = buildReadinessPlan(route);
    expect(plan.map((c) => c.type)).toEqual([
      READINESS_CONDITION_TYPES.FONTS, READINESS_CONDITION_TYPES.NETWORK_IDLE,
      READINESS_CONDITION_TYPES.NO_LOADING_STATUS, READINESS_CONDITION_TYPES.CUSTOM_MARKER,
    ]);
  });

  it("throws for an unknown marker type rather than silently skipping it", () => {
    expect(() => buildReadinessPlan({ routeId: "x", readinessMarkers: [{ type: "made-up" }] })).toThrow(/Unknown readiness marker type/);
  });

  it("throws when a custom-marker condition has no selector", () => {
    expect(() => buildReadinessPlan({ routeId: "x", readinessMarkers: [{ type: READINESS_CONDITION_TYPES.CUSTOM_MARKER }] })).toThrow(/missing a selector/);
  });

  it("is deterministic: the same route produces an identical plan every time", () => {
    expect(buildReadinessPlan(baseRoute)).toEqual(buildReadinessPlan(baseRoute));
  });

  it("throws when called without a route", () => {
    expect(() => buildReadinessPlan(null)).toThrow();
  });
});

function mockPage() {
  return {
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
  };
}

describe("waitForReadiness", () => {
  it("resolves every condition in order and returns matching readiness evidence", async () => {
    const page = mockPage();
    const plan = buildReadinessPlan(baseRoute);
    const evidence = await waitForReadiness(page, plan);

    expect(evidence).toHaveLength(2);
    expect(evidence.map((e) => e.type)).toEqual([READINESS_CONDITION_TYPES.FONTS, READINESS_CONDITION_TYPES.NETWORK_IDLE]);
    expect(evidence.every((e) => e.satisfied === true)).toBe(true);
    expect(evidence.every((e) => typeof e.waitedMs === "number")).toBe(true);
    expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle", expect.objectContaining({ timeout: expect.any(Number) }));
  });

  it("calls waitForSelector with the route's declared selector for a custom-marker condition", async () => {
    const page = mockPage();
    const route = { routeId: "x", readinessMarkers: [{ type: READINESS_CONDITION_TYPES.CUSTOM_MARKER, selector: "[data-fb-ui-ready]" }] };
    await waitForReadiness(page, buildReadinessPlan(route));
    expect(page.waitForSelector).toHaveBeenCalledWith("[data-fb-ui-ready]", expect.objectContaining({ state: "attached" }));
  });

  it("fails closed with ReadinessTimeoutError when a condition never resolves", async () => {
    const page = mockPage();
    page.waitForLoadState.mockRejectedValue(new Error("Timeout 10000ms exceeded"));
    await expect(waitForReadiness(page, buildReadinessPlan(baseRoute))).rejects.toThrow(ReadinessTimeoutError);
  });

  it("stops at the first failing condition and does not attempt later ones", async () => {
    const page = mockPage();
    page.evaluate.mockRejectedValue(new Error("fonts never settled"));
    await expect(waitForReadiness(page, buildReadinessPlan(baseRoute))).rejects.toThrow(ReadinessTimeoutError);
    expect(page.waitForLoadState).not.toHaveBeenCalled();
  });
});
