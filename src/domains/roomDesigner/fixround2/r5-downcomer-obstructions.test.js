// R5 probe (PR #668 fix round 2) — downcomer platform obstructions
// are not validated. ChatGPT's executed counterexample
// (downcomerDeckObstruction): a pipe routed through the first column
// platform (deck elevation 180 on a raised-base column) yields
// access-envelope errors [] — accessEnvelopeErrors only ever visits
// each symbol's primary manway package and never enumerates the
// generated downcomer platform decks or ladder paths.
//
// These probes FAIL against the round-1 implementation and must PASS
// after the fix: every generated access assembly (downcomer platform
// decks at their real world datums, and the ladder paths serving
// them) is obstruction-validated with stable component identity.

import { describe, expect, it, beforeEach } from "vitest";
import {
  addPipeRun,
  createEmptyDesign,
  placeSymbol,
  resetDesignerIds,
} from "../designerDocument";
import { accessEnvelopeErrors } from "../vesselAccess";

beforeEach(() => {
  resetDesignerIds();
});

function columnDesign(patch = {}) {
  let design = createEmptyDesign();
  design = placeSymbol(design, "processEquipment", "column", 0, 0, { id: "c" });
  design = {
    ...design,
    symbols: design.symbols.map((s) => (s.id === "c" ? { ...s, heightIn: 240, ...patch } : s)),
  };
  return design;
}

describe("R5 downcomer platform decks and ladders are obstruction-validated", () => {
  it("a clear column reports no access-envelope errors", () => {
    expect(accessEnvelopeErrors(columnDesign())).toEqual([]);
  });

  it("a pipe through the first platform deck is a named obstruction", () => {
    let design = columnDesign();
    // Level-1 deck: center (0, 36), elevation 120 (base 0 + level 120).
    design = addPipeRun(design, [{ x: -200, y: 36 }, { x: 200, y: 36 }], {
      id: "through-deck",
      diameterIn: 2,
      elevationIn: 120,
    });
    const errors = accessEnvelopeErrors(design);
    expect(errors.some((e) => /downcomer/i.test(e) && /obstruct/i.test(e))).toBe(true);
  });

  it("a pipe through the second platform deck names that level", () => {
    let design = columnDesign();
    design = addPipeRun(design, [{ x: -200, y: 36 }, { x: 200, y: 36 }], {
      id: "through-deck-2",
      diameterIn: 2,
      elevationIn: 240,
    });
    const errors = accessEnvelopeErrors(design);
    expect(errors.some((e) => /downcomer level 2/i.test(e) && /obstruct/i.test(e))).toBe(true);
  });

  it("raised base: the first platform rides at base + level and is validated there", () => {
    let design = columnDesign({ baseElevationIn: 60 });
    // First platform deck elevation = 60 + 120 = 180 (ChatGPT's deck).
    design = addPipeRun(design, [{ x: -200, y: 36 }, { x: 200, y: 36 }], {
      id: "through-deck-raised",
      diameterIn: 2,
      elevationIn: 180,
    });
    const errors = accessEnvelopeErrors(design);
    expect(errors.some((e) => /downcomer/i.test(e) && /obstruct/i.test(e))).toBe(true);
  });

  it("a pipe through a platform ladder path is a named obstruction", () => {
    let design = columnDesign();
    // Level-1 ladder: stands at the deck's outer edge (center
    // (0, 54)), climbing grade 0 -> deck 120. A pipe crossing its
    // plan quad inside the climb band blocks it.
    design = addPipeRun(design, [{ x: -200, y: 54 }, { x: 200, y: 54 }], {
      id: "through-ladder",
      diameterIn: 2,
      elevationIn: 60,
    });
    const errors = accessEnvelopeErrors(design);
    expect(errors.some((e) => /ladder/i.test(e) && /obstruct/i.test(e))).toBe(true);
  });

  it("a pipe at deck elevation but clear of the deck footprint is not flagged", () => {
    let design = columnDesign();
    design = addPipeRun(design, [{ x: -200, y: 200 }, { x: 200, y: 200 }], {
      id: "clear-pipe",
      diameterIn: 2,
      elevationIn: 120,
    });
    expect(accessEnvelopeErrors(design)).toEqual([]);
  });
});
