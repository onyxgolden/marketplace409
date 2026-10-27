// H0 (home parity) — homeOverlays schema, validation, and references.
//
// Covers the brief §3 record contract and the HomeOverlays.references
// acceptance: malformed overlay metadata refused, identical ids in
// different levels/trades remain distinct, and endpoint references resolve
// only within their own level + trade (never by proximity or coincidence).

import { describe, expect, it } from "vitest";
import {
  HOME_OVERLAY_TRADES,
  HOME_OVERLAYS_VERSION,
  checkRunEndpointCompatibility,
  emptyHomeOverlays,
  findDanglingRefs,
  getHomeOverlays,
  makeEndpointRef,
  normalizeHomeOverlays,
  refsEqual,
  remapOverlayReferences,
  resolveEndpointRef,
  setHomeOverlays,
  tradeOfService,
  validateHomeOverlays,
} from "./homeOverlays";

const LEVEL = "level_1";

/** One small valid block per trade, with a resolvable endpoint chain. */
function validBlock() {
  return {
    version: HOME_OVERLAYS_VERSION,
    electrical: {
      devices: [
        {
          id: "panel-1",
          catalogId: "load-center",
          x: 10,
          y: 20,
          ports: [{ id: "main", service: "circuit" }],
        },
        {
          id: "outlet-1",
          catalogId: "outlet-duplex",
          x: 60,
          y: 20,
          ports: [{ id: "in", service: "circuit" }],
        },
      ],
      runs: [
        {
          id: "circuit-1",
          service: "circuit",
          points: [
            { x: 10, y: 20 },
            { x: 60, y: 20 },
          ],
          startRef: {
            levelId: LEVEL,
            trade: "electrical",
            entityKind: "device",
            entityId: "panel-1",
            portId: "main",
          },
          endRef: {
            levelId: LEVEL,
            trade: "electrical",
            entityKind: "device",
            entityId: "outlet-1",
            portId: "in",
          },
        },
      ],
      nodes: [],
      annotations: [
        {
          id: "note-1",
          text: "Panel schedule A",
          position: { x: 10, y: 10 },
          targetRef: {
            levelId: LEVEL,
            trade: "electrical",
            entityKind: "device",
            entityId: "panel-1",
            portId: "main",
          },
        },
      ],
    },
    plumbing: {
      devices: [
        {
          id: "heater-1",
          catalogId: "water-heater",
          x: 30,
          y: 40,
          linkedBaseRef: { kind: "furniture", id: "furn-9" },
          ports: [
            { id: "cold-in", service: "cold" },
            { id: "hot-out", service: "hot" },
          ],
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
            levelId: LEVEL,
            trade: "plumbing",
            entityKind: "device",
            entityId: "heater-1",
            portId: "cold-in",
          },
          attributes: { material: "PEX-A expansion", diameterIn: 0.75 },
        },
      ],
      nodes: [{ id: "tee-1", kind: "tee", x: 15, y: 40, ports: [{ id: "a", service: "cold" }] }],
      annotations: [],
    },
    hvac: {
      devices: [],
      runs: [],
      nodes: [
        {
          id: "riser-1",
          kind: "riser-stub",
          x: 50,
          y: 50,
          ports: [{ id: "up", service: "supply" }],
        },
      ],
      annotations: [],
    },
  };
}

describe("homeOverlays — validation", () => {
  it("accepts a well-formed block and normalizes defaults without mutating input", () => {
    const block = validBlock();
    const before = JSON.stringify(block);
    const normalized = normalizeHomeOverlays(block);
    expect(validateHomeOverlays(block)).toEqual([]);
    expect(normalized.version).toBe(HOME_OVERLAYS_VERSION);
    // rotationDeg defaults to 0; missing collections become empty arrays.
    expect(normalized.electrical.devices[0].rotationDeg).toBe(0);
    expect(normalized.hvac.devices).toEqual([]);
    expect(JSON.stringify(block)).toBe(before);
  });

  it("accepts an absent block (absence means no overlays) and an empty block", () => {
    expect(validateHomeOverlays(emptyHomeOverlays())).toEqual([]);
    expect(emptyHomeOverlays().electrical).toEqual({
      devices: [],
      runs: [],
      nodes: [],
      annotations: [],
    });
  });

  it.each([
    ["wrong version", (b) => ({ ...b, version: 2 })],
    ["unknown top-level key", (b) => ({ ...b, surprise: true })],
    ["unknown trade key", (b) => ({ ...b, gas: { devices: [] } })],
    ["unknown collection key", (b) => ({ ...b, electrical: { widgets: [] } })],
    ["duplicate device id in one collection", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        devices: [...b.electrical.devices, { ...b.electrical.devices[0] }],
      },
    })],
    ["unknown run service", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        runs: [{ ...b.electrical.runs[0], service: "gas" }],
      },
    })],
    ["unknown node kind", (b) => ({
      ...b,
      hvac: { nodes: [{ id: "n", kind: "warp-drive", x: 1, y: 2 }] },
    })],
    ["non-finite device coordinate", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        devices: [{ ...b.electrical.devices[0], x: Number.NaN }],
      },
    })],
    ["run with one point", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        runs: [{ ...b.electrical.runs[0], points: [{ x: 1, y: 2 }] }],
      },
    })],
    ["unknown device field", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        devices: [{ ...b.electrical.devices[0], onClick: "x" }],
      },
    })],
    ["attribute carrying a URL key", (b) => ({
      ...b,
      plumbing: {
        ...b.plumbing,
        runs: [{ ...b.plumbing.runs[0], attributes: { dataUrl: "data:text/html,<script>" } }],
      },
    })],
    ["attribute with a nested object value", (b) => ({
      ...b,
      plumbing: {
        ...b.plumbing,
        runs: [{ ...b.plumbing.runs[0], attributes: { spec: { deep: true } } }],
      },
    })],
    ["ref addressing another trade", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        runs: [
          {
            ...b.electrical.runs[0],
            endRef: { ...b.electrical.runs[0].endRef, trade: "plumbing" },
          },
        ],
      },
    })],
    ["ref missing portId", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        runs: [
          {
            ...b.electrical.runs[0],
            endRef: { ...b.electrical.runs[0].endRef, portId: "" },
          },
        ],
      },
    })],
    ["annotation text not a string", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        annotations: [{ ...b.electrical.annotations[0], text: 42 }],
      },
    })],
    ["duplicate port id on one device", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        devices: [
          {
            ...b.electrical.devices[0],
            ports: [
              { id: "main", service: "circuit" },
              { id: "main", service: "circuit" },
            ],
          },
        ],
      },
    })],
    ["port service outside the trade vocabulary", (b) => ({
      ...b,
      electrical: {
        ...b.electrical,
        devices: [
          { ...b.electrical.devices[0], ports: [{ id: "main", service: "cold" }] },
        ],
      },
    })],
  ])("refuses malformed metadata: %s", (_label, mutate) => {
    const problems = validateHomeOverlays(mutate(validBlock()));
    expect(problems.length).toBeGreaterThan(0);
    expect(() => normalizeHomeOverlays(mutate(validBlock()))).toThrow();
  });

  it("refuses a non-object block", () => {
    expect(validateHomeOverlays(null).length).toBeGreaterThan(0);
    expect(validateHomeOverlays("nope").length).toBeGreaterThan(0);
    expect(validateHomeOverlays([]).length).toBeGreaterThan(0);
  });
});

describe("homeOverlays — set/get on designs", () => {
  it("sets a normalized block and clears it back to the legacy shape", () => {
    const design = { version: 1, walls: [] };
    const withBlock = setHomeOverlays(design, validBlock());
    expect(getHomeOverlays(withBlock).version).toBe(HOME_OVERLAYS_VERSION);
    expect(design.homeOverlays).toBeUndefined(); // no mutation
    const cleared = setHomeOverlays(withBlock, null);
    expect("homeOverlays" in cleared).toBe(false);
    expect(getHomeOverlays(cleared)).toBeUndefined();
  });

  it("throws on a malformed block instead of storing it", () => {
    expect(() =>
      setHomeOverlays({ version: 1, walls: [] }, { version: 99 }),
    ).toThrow();
  });
});

describe("HomeOverlays.references", () => {
  it("resolves only within the same level + trade", () => {
    const block = validBlock();
    const panel = resolveEndpointRef(
      block,
      makeEndpointRef({
        levelId: LEVEL,
        trade: "electrical",
        entityKind: "device",
        entityId: "panel-1",
        portId: "main",
      }),
      LEVEL,
      "electrical",
    );
    expect(panel?.id).toBe("panel-1");
    // Same entity id in another trade or level does not resolve here.
    expect(
      resolveEndpointRef(block, block.electrical.runs[0].endRef, "level_2", "electrical"),
    ).toBeNull();
    expect(
      resolveEndpointRef(block, block.electrical.runs[0].endRef, LEVEL, "plumbing"),
    ).toBeNull();
    // A port that does not exist on the entity does not resolve.
    expect(
      resolveEndpointRef(
        block,
        makeEndpointRef({
          levelId: LEVEL,
          trade: "electrical",
          entityKind: "device",
          entityId: "panel-1",
          portId: "nope",
        }),
        LEVEL,
        "electrical",
      ),
    ).toBeNull();
  });

  it("identical ids in different trades and levels stay distinct", () => {
    const block = validBlock();
    // "panel-1" as a plumbing device id is a different entity, not a clash.
    block.plumbing.devices.push({
      id: "panel-1",
      catalogId: "water-heater",
      x: 1,
      y: 2,
      ports: [{ id: "main", service: "cold" }],
    });
    expect(validateHomeOverlays(block)).toEqual([]);
    expect(findDanglingRefs(block, LEVEL)).toEqual([]);
    // The electrical ref still resolves to the electrical device only.
    const entity = resolveEndpointRef(
      block,
      block.electrical.runs[0].startRef,
      LEVEL,
      "electrical",
    );
    expect(entity?.catalogId).toBe("load-center");
  });

  it("reports dangling refs with reasons, and ignores open draft runs", () => {
    const block = validBlock();
    block.plumbing.runs.push({
      id: "dangling-1",
      service: "cold",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      startRef: {
        levelId: LEVEL,
        trade: "plumbing",
        entityKind: "device",
        entityId: "ghost",
        portId: "in",
      },
      endRef: {
        levelId: LEVEL,
        trade: "plumbing",
        entityKind: "device",
        entityId: "heater-1",
        portId: "missing-port",
      },
    });
    // An open draft run (no refs at all) is not dangling.
    block.plumbing.runs.push({
      id: "draft-1",
      service: "hot",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    const dangling = findDanglingRefs(block, LEVEL);
    expect(dangling.map((d) => d.where)).toEqual([
      "run dangling-1 startRef",
      "run dangling-1 endRef",
    ]);
    expect(dangling[0].reason).toMatch("does not exist");
    expect(dangling[1].reason).toMatch("port");
  });

  it("flags wrong-service endpoints and leaves open drafts alone", () => {
    const block = validBlock();
    const coldRun = block.plumbing.runs[0];
    expect(checkRunEndpointCompatibility(block, coldRun, LEVEL)).toEqual([]);
    // Rewire the run's end to the heater's HOT port: wrong service.
    const wrong = {
      ...coldRun,
      endRef: { ...coldRun.endRef, portId: "hot-out" },
    };
    const problems = checkRunEndpointCompatibility(block, wrong, LEVEL);
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch("hot");
    // An open draft run (no endpoints) has no compatibility problems.
    expect(
      checkRunEndpointCompatibility(
        block,
        { id: "draft", service: "hot", points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
        LEVEL,
      ),
    ).toEqual([]);
  });

  it("remaps references for copies and preserves them for level switches", () => {
    const block = validBlock();
    // Copy: copied entities get new ids; refs to uncopied entities drop.
    const { block: copied, dropped } = remapOverlayReferences(block, {
      levelId: "level_2",
      ids: {
        electrical: { device: { "panel-1": "panel-9", "outlet-1": "outlet-9" } },
      },
      dropUnmappedRefs: true,
    });
    expect(copied.electrical.runs[0].startRef).toMatchObject({
      levelId: "level_2",
      entityId: "panel-9",
    });
    expect(copied.electrical.runs[0].endRef).toMatchObject({ entityId: "outlet-9" });
    // The plumbing run's endRef points at an entity with no mapping entry:
    // dropped and reported, so the paste never falsely connects.
    expect(copied.plumbing.runs[0].endRef).toBeUndefined();
    expect(dropped.map((d) => d.where)).toContain("run cold-1 endRef");
    expect(validateHomeOverlays(copied)).toEqual([]);
    // Level switch: no maps, refs and entities preserved exactly as stored
    // (remap preserves shape; it does not re-normalize — stored blocks are
    // already normalized by setHomeOverlays).
    const { block: switched, dropped: none } = remapOverlayReferences(block, {});
    expect(switched.electrical.runs[0].startRef).toEqual(
      block.electrical.runs[0].startRef,
    );
    expect(switched.electrical.devices).toEqual(block.electrical.devices);
    expect(validateHomeOverlays(switched)).toEqual([]);
    expect(none).toEqual([]);
    // Refs compare structurally, not by object identity.
    expect(
      refsEqual(block.electrical.runs[0].startRef, switched.electrical.runs[0].startRef),
    ).toBe(true);
    expect(
      refsEqual(block.electrical.runs[0].startRef, block.electrical.runs[0].endRef),
    ).toBe(false);
  });

  it("maps services to their owning trade", () => {
    expect(tradeOfService("circuit")).toBe("electrical");
    expect(tradeOfService("switch-control")).toBe("electrical");
    expect(tradeOfService("cold")).toBe("plumbing");
    expect(tradeOfService("vent")).toBe("plumbing");
    expect(tradeOfService("supply")).toBe("hvac");
    expect(tradeOfService("exhaust")).toBe("hvac");
    expect(tradeOfService("gas")).toBeNull();
  });

  it("exposes exactly the three trades", () => {
    expect(HOME_OVERLAY_TRADES).toEqual(["electrical", "plumbing", "hvac"]);
  });
});
