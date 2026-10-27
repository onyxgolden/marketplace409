// H0 fix round 2 — probes for the re-review residuals H679-002A and
// H679-003A. Each failing-before probe names the verdict behavior; the
// fix must flip it without breaking the existing H0 suites.

import { describe, expect, it } from "vitest";
import {
  HOME_OVERLAYS_VERSION,
  findDanglingRefs,
  remapOverlayReferences,
} from "./homeOverlays";
import { createHomeLayerMask, resolveHomeLayers } from "./homeLayers";

/** Source block at L1 with a heater/cold port; its run endRef and
 * annotation targetRef name L2 — foreign refs, dangling at L1. */
function collisionBlock() {
  return {
    version: HOME_OVERLAYS_VERSION,
    electrical: { devices: [], runs: [], nodes: [], annotations: [] },
    plumbing: {
      devices: [
        {
          id: "heater",
          catalogId: "water-heater",
          x: 30,
          y: 40,
          ports: [{ id: "cold", service: "cold" }],
        },
      ],
      runs: [
        {
          id: "cold-1",
          service: "cold",
          points: [
            { x: 0, y: 40 },
            { x: 30, y: 40 },
          ],
          endRef: {
            levelId: "L2",
            trade: "plumbing",
            entityKind: "device",
            entityId: "heater",
            portId: "cold",
          },
        },
      ],
      nodes: [],
      annotations: [
        {
          id: "note-1",
          text: "heater note",
          position: { x: 5, y: 5 },
          targetRef: {
            levelId: "L2",
            trade: "plumbing",
            entityKind: "device",
            entityId: "heater",
            portId: "cold",
          },
        },
      ],
    },
    hvac: { devices: [], runs: [], nodes: [], annotations: [] },
  };
}

describe("H679-002A — destination-collision foreign refs", () => {
  it("starts dangling at the source level", () => {
    expect(findDanglingRefs(collisionBlock(), "L1")).toHaveLength(2);
  });

  it("does NOT turn foreign refs into valid destination links in default mode", () => {
    const { block: moved, dropped } = remapOverlayReferences(collisionBlock(), {
      sourceLevelId: "L1",
      levelId: "L2",
    });
    // Preserved unresolvedness: the refs are dropped and reported, so the
    // moved block's own heater is never silently connected to them.
    expect(moved.plumbing.runs[0].endRef).toBeUndefined();
    expect(moved.plumbing.annotations[0].targetRef).toBeUndefined();
    expect(dropped.map((d) => d.where)).toContain("run cold-1 endRef");
    expect(dropped.map((d) => d.where)).toContain("annotation note-1 targetRef");
    // No refs remain to dangle or resolve: the heater device itself is
    // untouched, but nothing in the moved block points at it anymore.
    expect(findDanglingRefs(moved, "L2")).toHaveLength(0);
  });

  it("also drops colliding foreign refs in dropUnmappedRefs mode", () => {
    const { block: moved, dropped } = remapOverlayReferences(collisionBlock(), {
      sourceLevelId: "L1",
      levelId: "L2",
      dropUnmappedRefs: true,
    });
    expect(moved.plumbing.runs[0].endRef).toBeUndefined();
    expect(moved.plumbing.annotations[0].targetRef).toBeUndefined();
    expect(dropped).toHaveLength(2);
  });

  it("keeps non-colliding foreign refs unresolved in default mode", () => {
    const { block: moved, dropped } = remapOverlayReferences(collisionBlock(), {
      sourceLevelId: "L1",
      levelId: "L3",
    });
    expect(moved.plumbing.runs[0].endRef).toMatchObject({ levelId: "L2" });
    expect(moved.plumbing.annotations[0].targetRef).toMatchObject({ levelId: "L2" });
    expect(dropped).toEqual([]);
    expect(findDanglingRefs(moved, "L3")).toHaveLength(2);
  });
});

/** Same heater block, but the run/annotation refs belong to the source
 * level L1 — the true ID-only gap: with no level rewrite, the id-only
 * branch never applied dropUnmappedRefs to unmapped source-level refs. */
function sourceRefBlock() {
  const block = collisionBlock();
  block.plumbing.runs[0].endRef = {
    levelId: "L1",
    trade: "plumbing",
    entityKind: "device",
    entityId: "heater",
    portId: "cold",
  };
  block.plumbing.annotations[0].targetRef = {
    levelId: "L1",
    trade: "plumbing",
    entityKind: "device",
    entityId: "heater",
    portId: "cold",
  };
  return block;
}

describe("H679-002A — ID-only drop contract", () => {
  it("drops unmapped source-level refs with an empty id map when drop is true", () => {
    const { block: result, dropped } = remapOverlayReferences(sourceRefBlock(), {
      sourceLevelId: "L1",
      ids: {},
      dropUnmappedRefs: true,
    });
    expect(result.plumbing.runs[0].endRef).toBeUndefined();
    expect(result.plumbing.annotations[0].targetRef).toBeUndefined();
    expect(dropped.map((d) => d.where)).toContain("run cold-1 endRef");
    expect(dropped.map((d) => d.where)).toContain("annotation note-1 targetRef");
  });

  it("keeps unmapped source-level refs when drop is false", () => {
    const { block: result, dropped } = remapOverlayReferences(sourceRefBlock(), {
      sourceLevelId: "L1",
      ids: {},
    });
    expect(result.plumbing.runs[0].endRef).toMatchObject({ levelId: "L1" });
    expect(result.plumbing.annotations[0].targetRef).toMatchObject({ levelId: "L1" });
    expect(dropped).toEqual([]);
  });

  it("drops only the unmapped half of a partial id map when drop is true", () => {
    const block = sourceRefBlock();
    block.plumbing.runs.push({
      id: "cold-2",
      service: "cold",
      points: [
        { x: 0, y: 50 },
        { x: 30, y: 50 },
      ],
      endRef: {
        levelId: "L1",
        trade: "plumbing",
        entityKind: "device",
        entityId: "other",
        portId: "cold",
      },
    });
    const { block: result, dropped } = remapOverlayReferences(block, {
      sourceLevelId: "L1",
      ids: { plumbing: { device: { heater: "heater-copy" } } },
      dropUnmappedRefs: true,
    });
    // The mapped source-level ref follows its entry; the unmapped one
    // drops with a report (no level rewrite, so levelId stays L1).
    expect(result.plumbing.runs[0].endRef).toMatchObject({ entityId: "heater-copy" });
    expect(result.plumbing.runs[1].endRef).toBeUndefined();
    expect(result.plumbing.annotations[0].targetRef).toMatchObject({
      entityId: "heater-copy",
    });
    expect(dropped.map((d) => d.where)).toContain("run cold-2 endRef");
  });
});

describe("H679-003A — inherited mask values", () => {
  it("refuses an inherited string value", () => {
    expect(() => createHomeLayerMask(Object.create({ electrical: "false" }))).toThrow(
      /must be a boolean/,
    );
  });

  it("refuses an inherited object value", () => {
    expect(() => createHomeLayerMask(Object.create({ plumbing: {} }))).toThrow(
      /must be a boolean/,
    );
  });

  it("refuses an inherited null value", () => {
    expect(() => createHomeLayerMask(Object.create({ hvac: null }))).toThrow(
      /must be a boolean/,
    );
  });

  it("an inherited value must not control rendering", () => {
    const input = Object.create({ electrical: "false" });
    expect(() => createHomeLayerMask(input)).toThrow();
    // And a legitimate inherited boolean is consumed as a boolean, not
    // reintroduced as a non-boolean.
    const ok = createHomeLayerMask(Object.create({ electrical: true }));
    expect(ok.electrical).toBe(true);
    expect(resolveHomeLayers(ok, { mode: "home" }).trades.electrical).toBe(true);
  });

  it("keeps legitimate own booleans and undefined-as-absence working", () => {
    expect(createHomeLayerMask({ electrical: true }).electrical).toBe(true);
    expect(createHomeLayerMask({ electrical: undefined }).electrical).toBe(false);
    expect(createHomeLayerMask(Object.create(null, { electrical: { value: true, enumerable: true } })).electrical).toBe(true);
  });
});
