// Regression test for the split designer reducer (reducer/*.js).
// Replays the action battery from __battery.js and pins the exact state
// transitions (and no-op reference identity) that the original single-switch
// reducer produced — captured once in __slice-regression.fixture.json.
// Any slice change that alters behavior will fail here.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  designerReducer,
  createInitialState,
  TOOLS,
} from "./designerReducer";
import { resetDesignerIds } from "@/domains/roomDesigner/designerDocument";
import { BATTERY } from "./reducer/__battery";

const dir = join(dirname(fileURLToPath(import.meta.url)), "reducer");
const FIXTURE = JSON.parse(
  readFileSync(join(dir, "__slice-regression.fixture.json"), "utf8"),
);

describe("designer reducer slices preserve behavior", () => {
  it("public contract is intact", () => {
    expect(Array.isArray(TOOLS)).toBe(true);
    expect(TOOLS).toContain("select");
    resetDesignerIds();
    const s = createInitialState();
    expect(Object.keys(s).sort()).toEqual([
      "calibration",
      "clipboard",
      "design",
      "designRevision",
      "dirty",
      "future",
      "layerVisibility",
      "libraryDomain",
      "multiSelection",
      "orthoSnap",
      "past",
      "pendingCatalogId",
      "pendingCustomShape",
      "pendingPipe",
      "pendingRoomTemplate",
      "pendingSymbol",
      "selection",
      "tool",
      "view",
    ]);
  });

  for (const [name, steps] of BATTERY) {
    it(`pins transitions: ${name}`, () => {
      const expected = FIXTURE.find((f) => f.name === name);
      expect(expected).toBeDefined();
      resetDesignerIds();
      let s = createInitialState();
      const refs = [];
      for (const st of steps) {
        const act = typeof st === "function" ? st(s) : st;
        const next = designerReducer(s, act);
        refs.push(next === s);
        s = next;
      }
      expect(refs).toEqual(expected.refs);
      expect(s).toEqual(expected.final);
    });
  }
});
