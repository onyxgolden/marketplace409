import { describe, expect, it } from "vitest";
import { validateHomeProject } from "./homeProject";
import { findSymbol } from "./symbolRegistry";
import {
  buildFccuPlotPlan,
  FCCU_SAMPLE_NAME,
  FCCU_SAMPLE_SEED_ID,
  resetFccuSampleIds,
} from "./fccuPlotPlanSample";
import { SAMPLE_PROJECTS } from "./sampleProjects";

const EXPECTED_TAGS = [
  "R-101", "R-102",
  "T-101", "T-102",
  "K-101", "K-102",
  "E-101", "E-102", "E-103", "E-104",
  "P-101", "P-102", "P-103", "P-104", "P-105", "P-106",
  "V-101", "V-102",
  "FL-101",
];

function build() {
  resetFccuSampleIds();
  return buildFccuPlotPlan();
}

function designOf(project) {
  expect(project.levels).toHaveLength(1);
  return project.levels[0].design;
}

function distanceFt(a, b) {
  const dx = (a.x - b.x) / 12;
  const dy = (a.y - b.y) / 12;
  return Math.hypot(dx, dy);
}

describe("fccuPlotPlanSample: fictional FCCU plot plan seed", () => {
  it("builds a valid single-level project", () => {
    const project = build();
    expect(validateHomeProject(project)).toEqual([]);
    expect(project.name).toBe(FCCU_SAMPLE_NAME);
    expect(project.levels.map((l) => l.name)).toEqual(["Plot Plan"]);
    // A seed carries no identity or history.
    expect(project.createdAt).toBeUndefined();
    expect(project.updatedAt).toBeUndefined();
  });

  it("exposes the sample in the gallery list", () => {
    const sample = SAMPLE_PROJECTS.find((s) => s.seedId === FCCU_SAMPLE_SEED_ID);
    expect(sample).toBeTruthy();
    expect(sample.name).toBe(FCCU_SAMPLE_NAME);
    expect(sample.levels).toEqual(["Plot Plan"]);
    expect(typeof sample.build).toBe("function");
  });

  it("places every expected tagged equipment symbol", () => {
    const design = designOf(build());
    const tags = (design.symbols || []).map((s) => s.tag).filter(Boolean);
    for (const tag of EXPECTED_TAGS) {
      expect(tags).toContain(tag);
    }
    // Tags are unique.
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("resolves every placed symbol against the registered catalogs", () => {
    const design = designOf(build());
    for (const inst of design.symbols || []) {
      expect(
        findSymbol(inst.domain, inst.symbolId),
        `${inst.domain}/${inst.symbolId} should be registered`,
      ).toBeTruthy();
    }
  });

  it("keeps the flare at a safe distance from the reactor", () => {
    const design = designOf(build());
    const byTag = Object.fromEntries(
      (design.symbols || []).map((s) => [s.tag, s]),
    );
    const flare = byTag["FL-101"];
    const reactor = byTag["R-101"];
    expect(flare).toBeTruthy();
    expect(reactor).toBeTruthy();
    // Ignition source well clear of process equipment.
    expect(distanceFt(flare, reactor)).toBeGreaterThan(300);
  });

  it("routes a relief header pipe run to the flare", () => {
    const design = designOf(build());
    const header = (design.pipes || []).find((r) => /relief header/i.test(r.service || ""));
    expect(header).toBeTruthy();
    expect(header.points.length).toBeGreaterThanOrEqual(2);
    const flare = (design.symbols || []).find((s) => s.tag === "FL-101");
    const last = header.points[header.points.length - 1];
    // Header terminates at the flare footprint.
    expect(distanceFt(last, flare)).toBeLessThan(10);
  });

  it("labels the control building and pipe rack areas", () => {
    const design = designOf(build());
    const labels = (design.rooms || []).map((r) => r.label);
    expect(labels).toContain("Control building");
    expect(labels).toContain("Pipe rack");
  });

  it("is deterministic across builds", () => {
    const a = JSON.stringify(build());
    const b = JSON.stringify(build());
    expect(a).toBe(b);
  });
});
