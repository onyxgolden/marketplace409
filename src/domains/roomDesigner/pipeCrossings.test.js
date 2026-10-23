import { describe, expect, it } from "vitest";
import {
  applyCrossingJogs,
  connectionFlanges,
  developedRunLengthIn,
  findPipeCrossings,
  pipeCrossingErrors,
  requiredSeparationIn,
  segmentElevationsForDesign,
} from "./pipeCrossings";
import { pipeDescriptors } from "./designerThreeModel";
import {
  addPipeRun,
  createEmptyDesign,
  deleteSymbol,
  moveSymbol,
  placeSymbol,
} from "./designerDocument";
import {
  detectRunAttachments,
  detectRunJunctions,
  reconcilePipeAttachments,
  reconcileRunJunctions,
} from "./pipeAttachments";

const run = (design, id) => design.pipes.find((p) => p.id === id);

// Two perpendicular 2-in runs crossing at (500, 500), both at the
// derived grade elevation (30 in) — the classic unresolved crossing.
function crossingDesign() {
  let design = createEmptyDesign();
  design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
  design = addPipeRun(design, [{ x: 500, y: 100 }, { x: 500, y: 900 }], { id: "b", diameterIn: 2 });
  return design;
}

// D2: a pipe must CHANGE ELEVATION to cross another pipe. Clearance is
// measured between centerlines against the pipes' OUTSIDE radii plus
// clearance, whatever their sizes.
describe("pipe crossings and elevation jogs", () => {
  it("required separation uses outside radii plus clearance", () => {
    // 2-in pipe: OD 2.375 -> r 1.1875; 12-in: OD 12.75 -> r 6.375.
    expect(requiredSeparationIn(2, 2)).toBeCloseTo(1.1875 + 1.1875 + 1, 9);
    expect(requiredSeparationIn(12, 2)).toBeCloseTo(6.375 + 1.1875 + 1, 9);
  });

  it("detects a same-elevation crossing as unresolved; different elevations resolve it", () => {
    const crossings = findPipeCrossings(crossingDesign());
    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toMatchObject({ aRunId: "a", bRunId: "b", x: 500, y: 500, resolved: false });

    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2, elevationIn: 30 });
    design = addPipeRun(design, [{ x: 500, y: 100 }, { x: 500, y: 900 }], { id: "b", diameterIn: 2, elevationIn: 90 });
    expect(findPipeCrossings(design)[0].resolved).toBe(true);
    expect(pipeCrossingErrors(design)).toEqual([]);
  });

  it("endpoint touches and tees are connections, not crossings", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    // End lands exactly ON run a (a tee), and another shares an endpoint.
    design = addPipeRun(design, [{ x: 500, y: 500 }, { x: 500, y: 900 }], { id: "tee", diameterIn: 2 });
    design = addPipeRun(design, [{ x: 900, y: 500 }, { x: 900, y: 900 }], { id: "corner", diameterIn: 2 });
    expect(findPipeCrossings(design)).toEqual([]);
    // A modeled tee (junction record derived from the touch) is a
    // connection, not a crossing and not an unmodeled contact.
    design = detectRunJunctions(design, "tee");
    expect(pipeCrossingErrors(design)).toEqual([]);
  });

  it("an unmodeled end-on-run touch is a named contact finding (D668-003)", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    design = addPipeRun(design, [{ x: 500, y: 500 }, { x: 500, y: 900 }], { id: "tee", diameterIn: 2 });
    // No junction record: the touch is not a crossing (it never was),
    // but it is no longer silent either.
    expect(findPipeCrossings(design)).toEqual([]);
    const errors = pipeCrossingErrors(design);
    expect(errors.some((e) => /unmodeled contact/i.test(e))).toBe(true);
  });

  it("validateDesign flags an unresolved crossing with a named error", () => {
    const errors = pipeCrossingErrors(crossingDesign());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/crosses pipe run/);
    expect(errors[0]).toMatch(/change elevation/);
  });

  it("applyCrossingJogs steps the edited run over the other, in elevation only", () => {
    const before = crossingDesign();
    const after = applyCrossingJogs(before, "b");
    // No unresolved crossing remains, and validation is clean.
    expect(findPipeCrossings(after).filter((c) => !c.resolved)).toEqual([]);
    expect(pipeCrossingErrors(after)).toEqual([]);
    // The jog is two vertical risers and a short elevated span
    // straddling the crossing (D668-002): the span's two vertices ride
    // at the other run's elevation plus the OD-rule separation for two
    // 2-in pipes; the risers share their plan positions.
    const b = run(after, "b");
    const stepElev = 30 + requiredSeparationIn(2, 2);
    const spanIdx = b.points
      .map((p, i) => (Math.abs(b.elevIn[i] - stepElev) < 1e-9 ? i : -1))
      .filter((i) => i >= 0);
    expect(spanIdx).toHaveLength(2);
    const [up, span] = spanIdx;
    expect(b.points[up]).toEqual(b.points[up - 1]); // riser: same plan
    expect(b.points[span]).toEqual(b.points[span + 1]); // riser: same plan
    expect(b.elevIn[up - 1]).toBeCloseTo(30, 9);
    expect(b.elevIn[span + 1]).toBeCloseTo(30, 9);
    // The other run is untouched...
    expect(run(after, "a")).toEqual(run(before, "a"));
    // ...and no plan (x, y) coordinate moved off the original line:
    // the jog is purely vertical (new vertices lie ON the segments).
    for (const p of b.points) {
      expect(p.x).toBe(500);
    }
  });

  it("jogs are deterministic and idempotent — re-applying changes nothing", () => {
    const once = applyCrossingJogs(crossingDesign(), "b");
    const twice = applyCrossingJogs(once, "b");
    expect(twice).toEqual(once);
    const again = applyCrossingJogs(crossingDesign(), "b");
    expect(again).toEqual(once);
  });

  it("a run with no crossings is returned unchanged (no baked profile)", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "solo", diameterIn: 2 });
    expect(applyCrossingJogs(design, "solo")).toBe(design);
  });

  it("a jog that cannot clear is refused, not faked (D668-002)", () => {
    // Two 12-in runs on 10-in segments crossing at their midpoints:
    // the required 13.75-in separation cannot fit between risers ~8 in
    // apart (or up a 5-in approach), so the jog is REFUSED — the run is
    // left unchanged and the crossing stays honestly unresolved, with
    // its validation error intact. A fake jog that renders but does
    // not clear is worse than no jog.
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 495, y: 500 }, { x: 505, y: 500 }], { id: "a", diameterIn: 12 });
    design = addPipeRun(design, [{ x: 500, y: 495 }, { x: 500, y: 505 }], { id: "b", diameterIn: 12 });
    const before = run(design, "b");
    const after = applyCrossingJogs(design, "b");
    const afterB = run(after, "b");
    // No jog geometry was inserted (still 2 points; only the derived
    // profile got baked into per-vertex elevations).
    expect(afterB.points).toEqual(before.points);
    expect(afterB.points).toHaveLength(2);
    expect(findPipeCrossings(after).filter((c) => !c.resolved)).toHaveLength(1);
    expect(pipeCrossingErrors(after).length).toBeGreaterThan(0);
  });

  it("a run crossing itself at one elevation is flagged", () => {
    let design = createEmptyDesign();
    design = addPipeRun(
      design,
      [
        { x: 100, y: 100 },
        { x: 900, y: 100 },
        { x: 900, y: 900 },
        { x: 400, y: 900 },
        { x: 400, y: 50 },
      ],
      { id: "loop", diameterIn: 2 },
    );
    const errors = pipeCrossingErrors(design);
    expect(errors.some((e) => /crosses itself/.test(e))).toBe(true);
  });

  it("collinear runs overlapping at the same elevation are flagged", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    design = addPipeRun(design, [{ x: 300, y: 500 }, { x: 700, y: 500 }], { id: "b", diameterIn: 2 });
    expect(pipeCrossingErrors(design).some((e) => /overlap along the same route/.test(e))).toBe(true);
  });

  it("a run through an unconnected equipment footprint is flagged; connecting exempts it", () => {
    let design = placeSymbol(createEmptyDesign(), "processEquipment", "vertical-vessel", 500, 500, { id: "v1" });
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "thru", diameterIn: 2 });
    expect(pipeCrossingErrors(design).some((e) => /passes through/.test(e))).toBe(true);
    // Pipes ride racks by design — a rack is never flagged.
    let rackDesign = placeSymbol(createEmptyDesign(), "processEquipment", "pipe-rack", 500, 500, { id: "r1" });
    rackDesign = addPipeRun(rackDesign, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "ride", diameterIn: 2 });
    expect(pipeCrossingErrors(rackDesign).some((e) => /passes through/.test(e))).toBe(false);
  });

  it("malformed stored elevations are validation errors; buried (negative) is fine", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 0, y: 0 }, { x: 100, y: 0 }], { id: "ug", diameterIn: 8, elevationIn: -36 });
    expect(pipeCrossingErrors(design)).toEqual([]);
    const bad = {
      ...design,
      pipes: design.pipes.map((p) => ({ ...p, elevIn: [10] })),
    };
    expect(pipeCrossingErrors(bad).some((e) => /malformed vertex elevations/.test(e))).toBe(true);
  });

  it("developed length counts plan length plus vertical steps", () => {
    const design = applyCrossingJogs(crossingDesign(), "b");
    const b = run(design, "b");
    const planOnly = 800;
    expect(developedRunLengthIn(design, b)).toBeGreaterThan(planOnly);
    // A flat run's developed length is its plan length.
    expect(developedRunLengthIn(design, run(design, "a"))).toBeCloseTo(800, 6);
  });

  it("the 3D profile follows the stored jog (riser at the step)", () => {
    const design = applyCrossingJogs(crossingDesign(), "b");
    const descriptor = pipeDescriptors(design).find((p) => p.id === "b");
    expect(descriptor.risers.length).toBeGreaterThan(0);
    const step = Math.max(...descriptor.segments.map((s) => s.yIn));
    expect(step).toBeGreaterThan(30);
  });

  it("a legacy run's 3D descriptor is unchanged when it has no stored profile", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "a", diameterIn: 2 });
    const descriptor = pipeDescriptors(design).find((p) => p.id === "a");
    expect(descriptor.segments.every((s) => s.yIn === 30)).toBe(true);
    expect(descriptor.flanges).toBeUndefined();
  });
});

// D3: every connection is a flanged connection — a flange exists
// exactly where a connection exists and disappears with it.
describe("flanged connections", () => {
  it("an attached end yields one nozzle flange; free ends yield none", () => {
    let design = placeSymbol(createEmptyDesign(), "processEquipment", "centrifugal-pump", 200, 200, { id: "p1" });
    // suction-in sits at (200, 191) for the default pump footprint.
    design = addPipeRun(design, [{ x: 200, y: 191 }, { x: 200, y: 40 }], { id: "s", diameterIn: 4 });
    design = detectRunAttachments(design, "s");
    const flanges = connectionFlanges(design);
    expect(flanges).toHaveLength(1);
    expect(flanges[0]).toMatchObject({ runId: "s", end: "start", kind: "nozzle", x: 200, y: 191, sizeIn: 4 });
    // Detach (delete the pump, reconcile) and the flange is gone:
    // a flange exists exactly where a connection exists.
    const detached = reconcilePipeAttachments(deleteSymbol(design, "p1"));
    expect(run(detached, "s").attachments).toBeUndefined();
    expect(connectionFlanges(detached)).toEqual([]);
  });

  it("a junctioned end yields a junction flange on the branch run", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "header", diameterIn: 6 });
    design = addPipeRun(design, [{ x: 500, y: 500 }, { x: 500, y: 900 }], { id: "branch", diameterIn: 4 });
    design = detectRunJunctions(design, "branch");
    expect(run(design, "branch").junctions).toEqual({ start: { runId: "header" } });
    const flanges = connectionFlanges(design);
    expect(flanges).toEqual([
      expect.objectContaining({ runId: "branch", end: "start", kind: "junction", x: 500, y: 500, sizeIn: 4 }),
    ]);
    // The 3D descriptor carries the flange too.
    const descriptor = pipeDescriptors(design).find((p) => p.id === "branch");
    expect(descriptor.flanges).toHaveLength(1);
    expect(descriptor.flanges[0]).toMatchObject({ x: 500, yIn: 30, kind: "junction" });
  });

  it("junction ends follow their host run and drop when the host moves away", () => {
    let design = createEmptyDesign();
    design = addPipeRun(design, [{ x: 100, y: 500 }, { x: 900, y: 500 }], { id: "header", diameterIn: 6 });
    design = addPipeRun(design, [{ x: 500, y: 500 }, { x: 500, y: 900 }], { id: "branch", diameterIn: 4 });
    design = detectRunJunctions(design, "branch");
    // Host's crossed segment moves within tolerance: the branch end follows.
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "header" ? { ...p, points: [{ x: 100, y: 500.4 }, { x: 900, y: 500.4 }] } : p,
      ),
    };
    design = reconcileRunJunctions(design);
    expect(run(design, "branch").points[0]).toEqual({ x: 500, y: 500.4 });
    expect(run(design, "branch").junctions).toEqual({ start: { runId: "header" } });
    // Host moves far away: the junction drops, the end stays put.
    design = {
      ...design,
      pipes: design.pipes.map((p) =>
        p.id === "header" ? { ...p, points: [{ x: 100, y: 700 }, { x: 900, y: 700 }] } : p,
      ),
    };
    design = reconcileRunJunctions(design);
    expect(run(design, "branch").junctions).toBeUndefined();
    expect(run(design, "branch").points[0]).toEqual({ x: 500, y: 500.4 });
    expect(connectionFlanges(design)).toEqual([]);
  });

  it("moving equipment keeps its flanged pipe ends attached", () => {
    let design = placeSymbol(createEmptyDesign(), "processEquipment", "centrifugal-pump", 200, 200, { id: "p1" });
    design = addPipeRun(design, [{ x: 200, y: 191 }, { x: 200, y: 40 }], { id: "s", diameterIn: 4 });
    design = detectRunAttachments(design, "s");
    const moved = reconcilePipeAttachments(moveSymbol(design, "p1", 260, 240));
    expect(run(moved, "s").points[0]).toEqual({ x: 260, y: 231 });
    const flanges = connectionFlanges(moved);
    expect(flanges).toHaveLength(1);
    expect(flanges[0]).toMatchObject({ kind: "nozzle", x: 260, y: 231 });
  });
});
