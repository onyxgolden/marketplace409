import { describe, expect, it } from "vitest";
import { findBreakpointRegressions } from "../breakpointRules.mjs";
import { FINDING_CATEGORY } from "../findingContracts.mjs";

const baseContext = { application: "app", routeId: "home", routePath: "/", screenshotHashByViewport: { desktop: `sha256:${"a".repeat(64)}`, tablet: `sha256:${"b".repeat(64)}`, mobile: `sha256:${"c".repeat(64)}` } };

function snapshotWithControls(names) {
  return { elements: names.map((name) => ({ selector: `button[aria-label="${name}"]`, isInteractive: true, visible: true, accessibleName: name })) };
}

describe("findBreakpointRegressions", () => {
  it("finds nothing when the same controls are present at every viewport", () => {
    const snapshotsByViewport = { desktop: snapshotWithControls(["Save", "Cancel"]), tablet: snapshotWithControls(["Save", "Cancel"]), mobile: snapshotWithControls(["Save", "Cancel"]) };
    expect(findBreakpointRegressions({ ...baseContext, snapshotsByViewport })).toEqual([]);
  });

  it("flags a control present at desktop and tablet but missing at mobile", () => {
    const snapshotsByViewport = { desktop: snapshotWithControls(["Save", "Cancel"]), tablet: snapshotWithControls(["Save", "Cancel"]), mobile: snapshotWithControls(["Save"]) };
    const findings = findBreakpointRegressions({ ...baseContext, snapshotsByViewport });
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe(FINDING_CATEGORY.BREAKPOINT_REGRESSION);
    expect(findings[0].affectedComponent).toBe("Cancel");
    expect(findings[0].viewport).toBe("mobile");
  });

  it("does not flag a control that was already absent at tablet (likely intentional responsive hiding)", () => {
    const snapshotsByViewport = { desktop: snapshotWithControls(["Save", "Advanced options"]), tablet: snapshotWithControls(["Save"]), mobile: snapshotWithControls(["Save"]) };
    expect(findBreakpointRegressions({ ...baseContext, snapshotsByViewport })).toEqual([]);
  });

  it("returns nothing when any of the three viewport snapshots is missing", () => {
    const snapshotsByViewport = { desktop: snapshotWithControls(["Save"]), tablet: snapshotWithControls(["Save"]) };
    expect(findBreakpointRegressions({ ...baseContext, snapshotsByViewport })).toEqual([]);
  });

  it("uses the correct screenshot hash for the mobile viewport where the regression appears", () => {
    const snapshotsByViewport = { desktop: snapshotWithControls(["Save"]), tablet: snapshotWithControls(["Save"]), mobile: snapshotWithControls([]) };
    const [finding] = findBreakpointRegressions({ ...baseContext, snapshotsByViewport });
    expect(finding.screenshotHash).toBe(baseContext.screenshotHashByViewport.mobile);
  });
});
