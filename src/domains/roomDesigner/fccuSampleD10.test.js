import { describe, expect, it, vi } from "vitest";

// D10-05 acceptance: the FCCU sample rebuilt under the D10
// routing / supports / access rules (brief
// designer-d10-routing-supports-access-implementation-brief-2026-10-23,
// head 8e425555; D10-06 scope ruling 2026-11-11).
//
// The sample is inspected through the same updateLevelDesign bypass
// the audit uses: two access residuals remain (see the pinned
// access test below) and validateDesign reports them, so the raw
// build throws. The test pins the achieved state exactly — routing
// 0, supports 0, head-nozzles 0, access exactly the two named
// V-101 residuals — so any regression or any silent change to the
// residuals fails it. It is NOT a 0-access assertion: the two
// residuals are port-placement conflicts (a port sitting inside
// another port's spur) that need a scope ruling to move a nozzle
// or port, not a pipe-routing fix.
vi.mock("./homeProject", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    updateLevelDesign: (project, levelId, updater) => ({
      ...project,
      levels: project.levels.map((l) =>
        l.id === levelId ? { ...l, design: updater(l.design) } : l,
      ),
    }),
  };
});

import { buildFccuPlotPlan } from "./fccuPlotPlanSample";
import { pipeRoutingRuleErrors } from "./pipeRoutingRules";
import { pipeSupportRuleErrors } from "./pipeSupports";
import { pipeAccessRuleErrors } from "./pipeAccess";
import { vesselHeadNozzleErrors } from "./vesselHeadNozzles";
import { physicalRouteIn } from "./pipeCrossings";

const project = buildFccuPlotPlan();
const design = project.levels[0].design;

describe("FCCU sample D10 acceptance (D10-05)", () => {
  it("is the industrial-mode sample with 91 runs", () => {
    expect(design.mode).toBe("industrial");
    expect(design.pipes).toHaveLength(91);
  });

  it("has routing 0, supports 0, head-nozzles 0", () => {
    expect(pipeRoutingRuleErrors(design)).toEqual([]);
    expect(pipeSupportRuleErrors(design)).toEqual([]);
    expect(vesselHeadNozzleErrors(design)).toEqual([]);
  });

  it("has exactly the two pinned V-101 access residuals", () => {
    const access = pipeAccessRuleErrors(design);
    expect(access).toHaveLength(2);
    expect(access[0]).toContain("path-acc-symbol_11-liquid-out");
    expect(access[0]).toContain("fccu_pipe_29");
    expect(access[1]).toContain("path-manway-symbol_11");
    expect(access[1]).toContain("fccu_pipe_86");
  });

  it("runs every pipe plan-orthogonal (R1, authored points)", () => {
    // Authored points only: physicalRouteIn inserts the module's
    // crossing jogs, which are diagonal offsets around a crossing
    // and are not authored runs. Epsilon 1e-6 in absorbs
    // floating-point rounding in anchor math (e.g. 3207.6000000000004
    // vs 3207.6 on the V-102 utility drops).
    const EPS = 1e-6;
    const same = (a, b) => Math.abs(a - b) < EPS;
    for (const run of design.pipes) {
      const pts = run.points || [];
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const a = pts[i];
        const b = pts[i + 1];
        const isVerticalLeg = same(a.x, b.x) && same(a.y, b.y);
        const isPlanLeg = same(a.x, b.x) || same(a.y, b.y);
        expect(isVerticalLeg || isPlanLeg).toBe(true);
      }
    }
  });

  it("changes elevation only via vertical legs", () => {
    for (const run of design.pipes) {
      const route = physicalRouteIn(design, run);
      for (let i = 0; i + 1 < route.length; i += 1) {
        const a = route[i];
        const b = route[i + 1];
        if (a.zIn !== b.zIn) {
          expect(a.x).toBe(b.x);
          expect(a.y).toBe(b.y);
        }
      }
    }
  });

  it("authors the V-101 head-nozzle schedule (R4)", () => {
    const v101 = design.symbols.find((s) => s.tag === "V-101");
    expect(v101).toBeDefined();
    const schedule = v101.headNozzleSchedule || v101.nozzleSchedule || [];
    const ids = schedule.map((n) => n.id);
    expect(ids).toContain("liquid-out");
    expect(ids).toContain("vapor-out");
    const liquid = schedule.find((n) => n.id === "liquid-out");
    expect(liquid.surface).toBe("head-west");
    expect(liquid.position).toBe("bottom");
    const vapor = schedule.find((n) => n.id === "vapor-out");
    expect(vapor.surface).toBe("head-east");
    expect(vapor.position).toBe("top");
  });

  it("carries openEnds on all 18 open ends", () => {
    const open = design.pipes.filter(
      (p) => p.openEnds && Object.keys(p.openEnds).length > 0,
    );
    const count = open.reduce(
      (n, p) => n + Object.keys(p.openEnds).length,
      0,
    );
    expect(count).toBe(18);
    expect(open.length).toBeGreaterThan(0);
  });

  it("resolves the D10-06 module gaps (no guide/spacing findings)", () => {
    const supports = pipeSupportRuleErrors(design);
    const guide = supports.filter((e) => e.includes("GUIDE_NOT_SCHEDULED"));
    expect(guide).toEqual([]);
    const spacing = supports.filter((e) => e.includes("SPACING_TOO_CLOSE"));
    expect(spacing).toEqual([]);
    // The 39 >10-in guide findings are gone: every >10-in run
    // selects the named cap profile (D10-06 Ruling 1).
    const big = design.pipes.filter((p) => (p.diameterIn ?? 0) > 10);
    expect(big.length).toBeGreaterThan(0);
    for (const run of big) {
      expect(run.guideProfile).toBe("conservative-10in-guide-cap-v1");
    }
  });
}, 30000);
