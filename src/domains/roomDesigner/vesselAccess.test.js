import { describe, expect, it } from "vitest";
import {
  MANWAY_ACCESS_TRIGGER_IN,
  accessPackageForManway,
  accessPackageLocal,
  accessPackageWorld,
  manwaySpec,
  manwayWorld,
  vesselAccessErrors,
} from "./vesselAccess";
import { PROCESS_EQUIPMENT as CATALOG } from "./processEquipmentCatalog";
import { createEmptyDesign, placeSymbol } from "./designerDocument";

const byId = (id) => CATALOG.find((s) => s.id === id);
const inst = (symbolId, extra = {}) => ({
  id: "i1",
  domain: "processEquipment",
  symbolId,
  x: 500,
  y: 500,
  rotationDeg: 0,
  ...extra,
});

// D4/D5: every vessel carries a manway; the sill (BOTTOM of the
// opening) decides access — strictly above 24 in earns a steel catwalk
// with its deck AT sill level plus a ladder from grade. Exactly 24 in
// earns nothing. This is a FORGE planning rule.
describe("vessel manways and the 24-inch access rule", () => {
  it("every vessel-class symbol carries a manway spec", () => {
    const vessels = [
      "vertical-vessel",
      "horizontal-drum",
      "knockout-drum",
      "three-phase-separator",
      "reflux-accumulator",
      "storage-tank",
      "dome-roof-tank",
      "floating-roof-tank",
      "pressure-sphere",
      "lpg-bullet",
      "day-tank",
    ];
    for (const id of vessels) {
      const spec = byId(id).manway;
      expect(spec, id).toBeTruthy();
      expect(spec.diameterIn).toBeGreaterThanOrEqual(18);
      expect(spec.diameterIn).toBeLessThanOrEqual(36);
      expect(Number.isFinite(spec.sillIn)).toBe(true);
    }
  });

  it("boundary fixtures: sill 23.999 and exactly 24 get no package; 24.001 does", () => {
    const mk = (sillIn) => ({ lx: 0, ly: 30, dirX: 0, dirY: 1, diameterIn: 24, sillIn });
    expect(accessPackageForManway(mk(23.999))).toBeNull();
    expect(accessPackageForManway(mk(MANWAY_ACCESS_TRIGGER_IN))).toBeNull();
    const pkg = accessPackageForManway(mk(24.001));
    expect(pkg).not.toBeNull();
    expect(pkg.deck.elevationIn).toBe(24.001); // deck AT sill level
    expect(pkg.ladder.fromIn).toBe(0); // ladder climbs from grade
    expect(pkg.ladder.toIn).toBe(24.001);
  });

  it("an instance override can carry a sill across the threshold", () => {
    const symbol = byId("three-phase-separator"); // catalog sill exactly 24
    expect(manwaySpec(symbol, inst("three-phase-separator")).sillIn).toBe(24);
    expect(accessPackageLocal(symbol, inst("three-phase-separator"))).toBeNull();
    const raised = inst("three-phase-separator", { manway: { sillIn: 30 } });
    const pkg = accessPackageLocal(symbol, raised);
    expect(pkg.deck.elevationIn).toBe(30);
    expect(pkg.ladder.toIn).toBe(30);
  });

  it("deck sits outside the footprint at sill level; ladder at the deck's outer edge", () => {
    const symbol = byId("vertical-vessel"); // manway south (0, 1), sill 30
    const pkg = accessPackageLocal(symbol, inst("vertical-vessel"));
    // local frame: manway at ly = depth/2; deck center one half-depth beyond
    expect(pkg.deck.elevationIn).toBe(30);
    expect(pkg.deck.cy).toBeGreaterThan(symbol.depthIn / 2);
    expect(pkg.ladder.cy).toBeGreaterThan(pkg.deck.cy);
    expect(pkg.ladder.fromIn).toBe(0);
  });

  it("low-sill vessels get no package", () => {
    expect(accessPackageLocal(byId("storage-tank"), inst("storage-tank"))).toBeNull(); // sill 6
    expect(accessPackageLocal(byId("horizontal-drum"), inst("horizontal-drum"))).toBeNull(); // sill 18
  });

  it("world package rotates with the vessel", () => {
    const symbol = byId("vertical-vessel");
    const flat = accessPackageWorld(symbol, inst("vertical-vessel"));
    const turned = accessPackageWorld(symbol, inst("vertical-vessel", { rotationDeg: 90 }));
    // South-facing deck rotates with the vessel (designer rotation is
    // clockwise on the plan: south -> west at +90 deg).
    expect(flat.deck.cx).toBeCloseTo(500, 6);
    expect(flat.deck.cy).toBeGreaterThan(500);
    expect(turned.deck.cy).toBeCloseTo(500, 6);
    expect(turned.deck.cx).toBeLessThan(500);
    expect(turned.deck.corners).toHaveLength(4);
    const mw = manwayWorld(symbol, inst("vertical-vessel", { rotationDeg: 90 }));
    expect(mw.dirX).toBeCloseTo(-1, 9);
    expect(mw.dirY).toBeCloseTo(0, 9);
  });

  it("user-deleted access (noAccess) suppresses the package and validation flags it", () => {
    const design = placeSymbol(createEmptyDesign(), "processEquipment", "vertical-vessel", 500, 500, {
      id: "v1",
    });
    expect(vesselAccessErrors(design)).toEqual([]);
    const suppressed = {
      ...design,
      symbols: design.symbols.map((s) => ({ ...s, noAccess: true })),
    };
    expect(accessPackageLocal(byId("vertical-vessel"), suppressed.symbols[0])).toBeNull();
    const errors = vesselAccessErrors(suppressed);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/no catwalk access/);
  });

  it("a malformed manway override is a validation error, not a crash", () => {
    const design = placeSymbol(createEmptyDesign(), "processEquipment", "vertical-vessel", 500, 500, {
      id: "v1",
    });
    const bad = { ...design, symbols: design.symbols.map((s) => ({ ...s, manway: { sillIn: "high" } })) };
    expect(vesselAccessErrors(bad)[0]).toMatch(/malformed manway override/);
  });
});
