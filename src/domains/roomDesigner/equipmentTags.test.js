// equipmentTags.test.js — auto-numbered equipment tags and the schedule.

import { describe, expect, it } from "vitest";
import { createEmptyDesign, placeSymbol, setSymbolTag } from "./designerDocument";
import { autoTagFor, equipmentSchedule, equipmentScheduleCsv, nextEquipmentTag } from "./equipmentTags";

const D = "processEquipment";
const place = (design, symbolId, tag) =>
  placeSymbol(design, D, symbolId, 0, 0, { tag: tag ?? autoTagFor(design, D, symbolId) ?? undefined });

describe("nextEquipmentTag", () => {
  it("starts at 101 and counts per prefix", () => {
    let d = createEmptyDesign();
    expect(nextEquipmentTag(d, "P")).toBe("P-101");
    d = place(d, "centrifugal-pump");
    d = place(d, "pd-pump");
    d = place(d, "vertical-vessel");
    expect(d.symbols.map((s) => s.tag)).toEqual(["P-101", "P-102", "V-101"]);
    expect(nextEquipmentTag(d, "P")).toBe("P-103");
  });

  it("continues after the highest number, never reusing a gap", () => {
    let d = place(createEmptyDesign(), "centrifugal-pump", "P-101");
    d = place(d, "centrifugal-pump", "P-107");
    expect(nextEquipmentTag(d, "P")).toBe("P-108");
  });

  it("ignores tags of other prefixes that merely start with the same letter", () => {
    const d = place(createEmptyDesign(), "relief-valve"); // PSV-101
    expect(d.symbols[0].tag).toBe("PSV-101");
    expect(nextEquipmentTag(d, "P")).toBe("P-101");
  });

  it("respects a tag the user renamed", () => {
    let d = place(createEmptyDesign(), "centrifugal-pump");
    d = setSymbolTag(d, d.symbols[0].id, "P-201");
    expect(nextEquipmentTag(d, "P")).toBe("P-202");
  });

  it("does not tag symbols from other domains", () => {
    expect(autoTagFor(createEmptyDesign(), "piping", "gate-valve")).toBeNull();
    expect(autoTagFor(createEmptyDesign(), D, "nope")).toBeNull();
  });
});

describe("equipmentSchedule", () => {
  it("lists process equipment by category, then tag in numeric order", () => {
    let d = createEmptyDesign();
    d = place(d, "vertical-vessel"); // V-101
    for (let i = 0; i < 10; i += 1) d = place(d, "centrifugal-pump"); // P-101..P-110
    d = placeSymbol(d, "piping", "gate-valve", 0, 0); // not process equipment
    const rows = equipmentSchedule(d);
    expect(rows).toHaveLength(11);
    expect(rows.slice(0, 3).map((r) => r.tag)).toEqual(["P-101", "P-102", "P-103"]);
    expect(rows[9].tag).toBe("P-110");
    expect(rows[10]).toMatchObject({ tag: "V-101", description: "Vertical vessel", category: "Vessels & storage" });
    expect(rows[10].sizeLabel).toBe("48″ × 48″ × 120″ H");
  });

  it("puts untagged pieces last in their category", () => {
    let d = place(createEmptyDesign(), "centrifugal-pump", "");
    d = place(d, "pd-pump");
    expect(equipmentSchedule(d).map((r) => r.tag)).toEqual(["P-101", ""]);
  });

  it("exports CSV with a header and quoted fields", () => {
    const d = place(createEmptyDesign(), "shell-tube-exchanger");
    expect(equipmentScheduleCsv(d)).toBe(
      '"Tag","Description","Category","Nominal size"\n"E-101","Shell-and-tube exchanger","Heat exchangers","144″ × 30″ × 42″ H"\n',
    );
  });
});
