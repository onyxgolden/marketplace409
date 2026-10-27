// H0 (home parity) — legacy round-trip acceptance.
//
// Covers the brief §3/§6 persistence contract and the
// HomeParity.legacyRoundTrip acceptance: legacy home/industrial JSON is
// unchanged by view-only use, old optional fields are retained on save,
// malformed overlay metadata is refused, and estimates stay
// byte-equivalent when overlays or layer visibility change. No rental or
// financial surface is touched by this slice (the diff is designer-domain
// + reducer only); no migration exists to run.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addOpening,
  addPipeRun,
  addRoomFromTemplate,
  addSheet,
  addWall,
  createEmptyDesign,
  parseDesign,
  placeFurniture,
  placeSymbol,
  renameRoom,
  resetDesignerIds,
  serializeDesign,
  setUnderlay,
  validateDesign,
} from "./designerDocument";
import { FURNITURE_CATALOG } from "./furnitureCatalog";
import {
  parseHomeProject,
  projectFromDesign,
  serializeHomeProject,
  validateHomeProject,
} from "./homeProject";
import { summarizeDesignForEstimating } from "./designerExports";
import {
  createHomeLayerMask,
  freezeHomePrintMask,
  printMaskTitle,
  resolveHomeLayers,
} from "./homeLayers";
import {
  emptyHomeOverlays,
  getHomeOverlays,
  setHomeOverlays,
} from "./homeOverlays";
import {
  createInitialState,
  designerReducer,
} from "../../components/designer/designerReducer";

beforeEach(() => {
  resetDesignerIds();
});

/** A legacy home design with walls, rooms, openings, furniture, a symbol,
 * a sheet, a camera view, and an underlay — but no homeOverlays field. */
function legacyHomeDesign() {
  let design = createEmptyDesign("Legacy home");
  design = addRoomFromTemplate(design, "bedroom", { x: 0, y: 0 });
  design = renameRoom(design, design.rooms[0].id, "Bedroom");
  design = addOpening(design, design.walls[0].id, {
    type: "door",
    offsetIn: 10,
    widthIn: 36,
  });
  design = placeFurniture(design, FURNITURE_CATALOG[0].id, 24, 24, 0);
  design = placeSymbol(design, "mepFixtures", "outlet-duplex", 48, 12, {});
  design = addSheet(design, "letter", "landscape", { x: 0, y: 0 });
  design = {
    ...design,
    cameraViews: [
      {
        id: "view-1",
        name: "Front",
        pose: {
          position: { x: 0, y: 0, z: 100 },
          target: { x: 0, y: 0, z: 0 },
        },
      },
    ],
  };
  design = setUnderlay(design, {
    name: "trace",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AAAA",
    widthPx: 100,
    heightPx: 80,
  });
  return design;
}

/** A legacy industrial design: walls, a pipe run, a sheet — no overlays. */
function legacyIndustrialDesign() {
  let design = createEmptyDesign("Legacy plant", { mode: "industrial" });
  design = addWall(design, { x: 0, y: 0 }, { x: 300, y: 0 });
  design = addPipeRun(
    design,
    [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
    ],
    { diameterIn: 2 },
  );
  design = addSheet(design, "arch-d", "landscape", { x: 0, y: 0 });
  return design;
}

describe("HomeParity.legacyRoundTrip", () => {
  it("round-trips legacy home JSON byte-identically through parse/serialize", () => {
    const design = legacyHomeDesign();
    expect(validateDesign(design)).toEqual([]);
    expect("homeOverlays" in design).toBe(false);
    const once = serializeDesign(design);
    const twice = serializeDesign(parseDesign(once));
    expect(twice).toBe(once);
    expect(validateDesign(parseDesign(once))).toEqual([]);
  });

  it("round-trips legacy industrial JSON byte-identically, pipes untouched", () => {
    const design = legacyIndustrialDesign();
    expect(validateDesign(design)).toEqual([]);
    const once = serializeDesign(design);
    const twice = serializeDesign(parseDesign(once));
    expect(twice).toBe(once);
    expect(parseDesign(once).pipes).toHaveLength(1);
    expect(parseDesign(once).mode).toBe("industrial");
  });

  it("retains old optional fields on save: sheets, camera views, underlay", () => {
    const design = legacyHomeDesign();
    const parsed = parseDesign(serializeDesign(design));
    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.sheets[0].sizeId).toBe("letter");
    expect(parsed.cameraViews).toHaveLength(1);
    expect(parsed.cameraViews[0].name).toBe("Front");
    expect(parsed.underlay.name).toBe("trace");
    expect(parsed.underlay.widthPx).toBe(100);
  });

  it("view-only use never mutates the design", () => {
    const design = legacyHomeDesign();
    const before = serializeDesign(design);
    // Everything a view pass does with H0: read overlays, resolve masks,
    // freeze a print mask, title it. None of it touches the document.
    expect(getHomeOverlays(design)).toBeUndefined();
    const mask = createHomeLayerMask({ electrical: true });
    const resolved = resolveHomeLayers(mask, { mode: "home", hasUnderlay: true });
    expect(resolved.trades.electrical).toBe(true);
    const frozen = freezeHomePrintMask(mask);
    expect(printMaskTitle(frozen.mask)).toBe("Base + Electrical");
    expect(serializeDesign(design)).toBe(before);
  });

  it("round-trips a home project with overlays, and one without", () => {
    const plain = projectFromDesign(legacyHomeDesign(), "Legacy project");
    const plainOnce = serializeHomeProject(plain);
    expect(serializeHomeProject(parseHomeProject(plainOnce))).toBe(plainOnce);

    const withOverlays = projectFromDesign(
      setHomeOverlays(legacyHomeDesign(), emptyHomeOverlays()),
      "Overlay project",
    );
    const overOnce = serializeHomeProject(withOverlays);
    const parsed = parseHomeProject(overOnce);
    expect(serializeHomeProject(parsed)).toBe(overOnce);
    expect(parsed.levels[0].design.homeOverlays).toEqual(emptyHomeOverlays());
    // And clearing the block restores the legacy shape exactly.
    const cleared = setHomeOverlays(parsed.levels[0].design, null);
    expect("homeOverlays" in cleared).toBe(false);
  });

  it("refuses malformed overlay metadata at the design and project boundaries", () => {
    const bad = { ...legacyHomeDesign(), homeOverlays: { version: 99 } };
    expect(validateDesign(bad).length).toBeGreaterThan(0);
    expect(validateDesign(bad)[0]).toMatch("homeOverlays");
    const project = projectFromDesign(legacyHomeDesign(), "P");
    const badProject = {
      ...project,
      levels: [{ ...project.levels[0], design: bad }],
    };
    // The project validator surfaces the design problem (validateDesign is
    // its per-level check), so a bad block cannot be saved via the API.
    expect(validateHomeProject(badProject).length).toBeGreaterThan(0);
  });

  it("keeps estimates byte-equivalent when overlays or visibility change", () => {
    const design = legacyHomeDesign();
    const withEmpty = setHomeOverlays(design, emptyHomeOverlays());
    const withDevice = setHomeOverlays(design, {
      version: 1,
      electrical: {
        devices: [
          {
            id: "outlet-1",
            catalogId: "outlet-duplex",
            x: 48,
            y: 12,
            ports: [{ id: "in", service: "circuit" }],
          },
        ],
        runs: [],
        nodes: [],
        annotations: [],
      },
    });
    const base = JSON.stringify(summarizeDesignForEstimating(design));
    expect(JSON.stringify(summarizeDesignForEstimating(withEmpty))).toBe(base);
    expect(JSON.stringify(summarizeDesignForEstimating(withDevice))).toBe(base);
    // Visibility is view preference: no mask value can change the seam.
    for (const mask of [
      createHomeLayerMask({}),
      createHomeLayerMask({ electrical: true, plumbing: true, hvac: true }),
      createHomeLayerMask({ base: false, hvac: true }),
    ]) {
      expect(resolveHomeLayers(mask, { mode: "home" })).toBeTruthy();
      expect(JSON.stringify(summarizeDesignForEstimating(design))).toBe(base);
    }
  });
});

describe("homeParity — reducer action", () => {
  const block = {
    version: 1,
    electrical: {
      devices: [
        {
          id: "panel-1",
          catalogId: "load-center",
          x: 10,
          y: 20,
          ports: [{ id: "main", service: "circuit" }],
        },
      ],
      runs: [],
      nodes: [],
      annotations: [],
    },
  };

  it("SET_HOME_OVERLAYS is one undoable step, undone and redone cleanly", () => {
    let state = createInitialState(createEmptyDesign("H0"));
    expect(state.design.homeOverlays).toBeUndefined();
    state = designerReducer(state, { type: "SET_HOME_OVERLAYS", overlays: block });
    expect(state.design.homeOverlays.version).toBe(1);
    expect(state.past).toHaveLength(1);
    expect(state.dirty).toBe(true);
    const undone = designerReducer(state, { type: "UNDO" });
    expect(undone.design.homeOverlays).toBeUndefined();
    const redone = designerReducer(undone, { type: "REDO" });
    expect(redone.design.homeOverlays.version).toBe(1);
  });

  it("SET_HOME_OVERLAYS clears with null and fails soft on malformed input", () => {
    let state = createInitialState(createEmptyDesign("H0"));
    state = designerReducer(state, { type: "SET_HOME_OVERLAYS", overlays: block });
    const pastLength = state.past.length;
    const cleared = designerReducer(state, { type: "SET_HOME_OVERLAYS", overlays: null });
    expect(cleared.design.homeOverlays).toBeUndefined();
    expect(cleared.past).toHaveLength(pastLength + 1);
    const bad = designerReducer(cleared, {
      type: "SET_HOME_OVERLAYS",
      overlays: { version: 99 },
    });
    expect(bad.design.homeOverlays).toBeUndefined();
    expect(bad.past).toHaveLength(cleared.past.length);
  });

  it("SET_HOME_OVERLAYS is ignored on industrial designs", () => {
    let state = createInitialState(createEmptyDesign("Ind", { mode: "industrial" }));
    state = designerReducer(state, { type: "SET_HOME_OVERLAYS", overlays: block });
    expect(state.design.homeOverlays).toBeUndefined();
    expect(state.past).toHaveLength(0);
  });
});

describe("homeParity — H679-001 validator and reducer paths (fix round)", () => {
  /** A block whose run point carries an unknown nested field (verdict probe). */
  function badPointBlock() {
    return {
      version: 1,
      electrical: {
        devices: [
          {
            id: "panel-1",
            catalogId: "load-center",
            x: 10,
            y: 20,
            ports: [{ id: "main", service: "circuit" }],
          },
        ],
        runs: [
          {
            id: "circuit-1",
            service: "circuit",
            points: [
              { x: 10, y: 20 },
              { x: 60, y: 20, script: "inert-probe" },
            ],
          },
        ],
        nodes: [],
        annotations: [],
      },
    };
  }

  it("refuses a bad nested point at the design and project boundaries", () => {
    const bad = { ...legacyHomeDesign(), homeOverlays: badPointBlock() };
    const designProblems = validateDesign(bad);
    expect(designProblems.length).toBeGreaterThan(0);
    expect(designProblems.join(" ")).toMatch("homeOverlays");
    const project = projectFromDesign(legacyHomeDesign(), "P");
    const badProject = {
      ...project,
      levels: [{ ...project.levels[0], design: bad }],
    };
    expect(validateHomeProject(badProject).length).toBeGreaterThan(0);
  });

  it("SET_HOME_OVERLAYS refuses a bad nested point atomically", () => {
    const good = {
      version: 1,
      electrical: {
        devices: [
          {
            id: "panel-1",
            catalogId: "load-center",
            x: 10,
            y: 20,
            ports: [{ id: "main", service: "circuit" }],
          },
        ],
        runs: [],
        nodes: [],
        annotations: [],
      },
    };
    let state = createInitialState(createEmptyDesign("H0"));
    state = designerReducer(state, { type: "SET_HOME_OVERLAYS", overlays: good });
    const pastLength = state.past.length;
    const before = JSON.stringify(state.design.homeOverlays);
    const refused = designerReducer(state, {
      type: "SET_HOME_OVERLAYS",
      overlays: badPointBlock(),
    });
    // Previous design and history preserved exactly; no partial set.
    expect(JSON.stringify(refused.design.homeOverlays)).toBe(before);
    expect(refused.past).toHaveLength(pastLength);
    expect(refused.design).toBe(state.design);
  });
});
