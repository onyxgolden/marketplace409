// temaTypes.test.js — TEMA letters, designations, presets, and combination rules.

import { describe, expect, it } from "vitest";
import {
  TEMA_FRONT_HEADS,
  TEMA_PRESETS,
  TEMA_REAR_HEADS,
  TEMA_RULES,
  TEMA_SHELLS,
  TEMA_TUBE_PASSES,
  normalizeTemaConfig,
  parseTemaDesignation,
  temaDesignation,
  validateTemaConfig,
} from "./temaTypes";

const letters = (list) => list.map((t) => t.letter);

describe("TEMA component inventory", () => {
  it("has the 5 front heads, 7 shells and 8 rear heads (20 types)", () => {
    expect(letters(TEMA_FRONT_HEADS)).toEqual(["A", "B", "C", "N", "D"]);
    expect(letters(TEMA_SHELLS)).toEqual(["E", "F", "G", "H", "J", "K", "X"]);
    expect(letters(TEMA_REAR_HEADS)).toEqual(["L", "M", "N", "P", "S", "T", "U", "W"]);
    expect(TEMA_FRONT_HEADS.length + TEMA_SHELLS.length + TEMA_REAR_HEADS.length).toBe(20);
  });

  it("gives every type a name and a description, and keeps N distinct per position", () => {
    for (const t of [...TEMA_FRONT_HEADS, ...TEMA_SHELLS, ...TEMA_REAR_HEADS]) {
      expect(t.name.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(10);
      expect(Object.isFrozen(t)).toBe(true);
    }
    const frontN = TEMA_FRONT_HEADS.find((t) => t.letter === "N");
    const rearN = TEMA_REAR_HEADS.find((t) => t.letter === "N");
    expect(frontN.position).toBe("front");
    expect(rearN.position).toBe("rear");
    expect(frontN.name).not.toBe(rearN.name);
  });
});

describe("designations", () => {
  it("formats and parses the three-letter designation", () => {
    expect(temaDesignation({ front: "A", shell: "E", rear: "S", tubePasses: 2 })).toBe("AES");
    expect(parseTemaDesignation("bem")).toEqual({ front: "B", shell: "E", rear: "M", tubePasses: 2 });
    expect(parseTemaDesignation("AE")).toBeNull();
    expect(parseTemaDesignation("QES")).toBeNull();
    expect(parseTemaDesignation("AUS")).toBeNull(); // U is not a shell
  });

  it("normalizes loose input and rejects junk", () => {
    expect(normalizeTemaConfig({ front: "a", shell: "e", rear: "u", tubePasses: "4" })).toEqual({
      front: "A", shell: "E", rear: "U", tubePasses: 4,
    });
    expect(normalizeTemaConfig({ front: "A", shell: "E", rear: "S" }).tubePasses).toBe(2);
    expect(normalizeTemaConfig(null)).toBeNull();
    expect(normalizeTemaConfig("AES")).toBeNull();
  });

  it("ships the AES, BEM, BEU and AET quick presets, all valid", () => {
    expect(Object.keys(TEMA_PRESETS)).toEqual(["AES", "BEM", "BEU", "AET"]);
    for (const [code, preset] of Object.entries(TEMA_PRESETS)) {
      expect(temaDesignation(preset)).toBe(code);
      const result = validateTemaConfig(preset);
      expect(result.valid, code).toBe(true);
      expect(result.warnings, code).toEqual([]);
    }
  });
});

describe("combination rules", () => {
  const check = (front, shell, rear, tubePasses = 2) => validateTemaConfig({ front, shell, rear, tubePasses });
  const ruleIds = (list) => list.map((r) => r.rule);

  it("documents every rule with a severity, summary and basis", () => {
    expect(TEMA_RULES.length).toBeGreaterThanOrEqual(8);
    for (const rule of TEMA_RULES) {
      expect(["block", "warn"]).toContain(rule.severity);
      expect(rule.summary.length).toBeGreaterThan(10);
      expect(rule.basis.length).toBeGreaterThan(10);
    }
    expect(new Set(TEMA_RULES.map((r) => r.id)).size).toBe(TEMA_RULES.length);
  });

  it("blocks unknown letters and letters in the wrong position", () => {
    expect(ruleIds(check("U", "E", "S").errors)).toContain("front-letter");
    expect(ruleIds(check("A", "S", "S").errors)).toContain("shell-letter");
    expect(ruleIds(check("A", "E", "A").errors)).toContain("rear-letter");
    expect(check("A", "E", "A").valid).toBe(false);
  });

  it("blocks unsupported tube-pass counts", () => {
    expect(ruleIds(check("A", "E", "S", 3).errors)).toContain("tube-passes");
    expect(ruleIds(check("A", "E", "S", 0).errors)).toContain("tube-passes");
    for (const n of TEMA_TUBE_PASSES) expect(ruleIds(check("A", "E", "S", n).errors)).not.toContain("tube-passes");
  });

  it("blocks a U-tube bundle with an odd number of passes", () => {
    const r = check("B", "E", "U", 1);
    expect(r.valid).toBe(false);
    expect(ruleIds(r.errors)).toEqual(["u-tube-even-passes"]);
    expect(check("B", "E", "U", 2).valid).toBe(true);
  });

  it("warns (but allows) unusual combinations", () => {
    const cases = [
      [["A", "E", "S", 1], "floating-head-single-pass"],
      [["A", "E", "T", 1], "floating-head-single-pass"],
      [["C", "E", "L", 2], "c-front-fixed-rear"],
      [["N", "E", "S", 2], "n-front-removable-rear"],
      [["N", "E", "U", 2], "n-front-removable-rear"],
      [["B", "K", "M", 2], "kettle-fixed-tubesheet"],
      [["A", "K", "W", 2], "kettle-packed-rear"],
      [["D", "E", "P", 2], "packed-rear-high-pressure-front"],
      [["A", "F", "S", 1], "f-shell-single-pass"],
      [["A", "E", "W", 4], "w-rear-multipass"],
    ];
    for (const [[f, s, r, p], rule] of cases) {
      const result = check(f, s, r, p);
      expect(result.valid, `${f}${s}${r}/${p}`).toBe(true);
      expect(ruleIds(result.warnings), `${f}${s}${r}/${p}`).toContain(rule);
    }
  });

  it("accepts common real-world designations without warnings", () => {
    for (const code of ["AEL", "AEM", "AEP", "AES", "AET", "AEU", "AEW", "BEM", "BEU", "BKU", "AKT", "NEN", "AFU", "AJS", "BXM", "AGS", "AHU", "DEU", "CEU"]) {
      const cfg = parseTemaDesignation(code);
      const result = validateTemaConfig(cfg);
      expect(result.valid, code).toBe(true);
      expect(result.warnings, code).toEqual([]);
    }
  });

  it("treats a missing config as invalid rather than throwing", () => {
    expect(validateTemaConfig(null).valid).toBe(false);
    expect(validateTemaConfig(undefined).errors[0].rule).toBe("config");
  });
});
