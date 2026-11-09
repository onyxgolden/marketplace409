import { describe, expect, it } from "vitest";
import {
  matchHeaders,
  parseDateCell,
  parseDelimitedText,
  validateAndPlanWorkPackageImport,
  PACKAGE_IMPORT_COLUMNS,
  STEP_IMPORT_COLUMNS,
} from "./workPackageImport.js";

describe("matchHeaders", () => {
  it("matches exact headers and SAP/Maximo/P6 aliases", () => {
    const mapping = matchHeaders(
      ["Title", "Work Order", "Work Center", "Scheduled Start", "Duration"],
      STEP_IMPORT_COLUMNS,
    );
    expect(mapping.map((m) => m.fieldKey)).toEqual([
      "title", "sourceRecordId", "craftLabel", null, "plannedDurationDays",
    ]);
    expect(matchHeaders(["Duration days"], STEP_IMPORT_COLUMNS)[0].fieldKey).toBe("plannedDurationDays");
  });

  it("leaves unknown headers unmapped", () => {
    expect(matchHeaders(["Random column"], PACKAGE_IMPORT_COLUMNS)[0].fieldKey).toBe(null);
  });
});

describe("parseDelimitedText", () => {
  it("parses CSV with quoted commas", () => {
    const parsed = parseDelimitedText('Title,Status\n"Kitchen, main",draft\nBath,planned\n');
    expect(parsed.headers).toEqual(["Title", "Status"]);
    expect(parsed.rows).toEqual([["Kitchen, main", "draft"], ["Bath", "planned"]]);
  });

  it("detects tabs for .tsv/.txt exports", () => {
    const parsed = parseDelimitedText("Title\tCraft\nPipe spool\tPipefitter\n");
    expect(parsed.headers).toEqual(["Title", "Craft"]);
    expect(parsed.rows).toEqual([["Pipe spool", "Pipefitter"]]);
  });

  it("skips fully blank lines", () => {
    const parsed = parseDelimitedText("Title\n\nA\n\n");
    expect(parsed.rows).toEqual([["A"]]);
  });
});

describe("parseDateCell", () => {
  it("accepts ISO and US dates and Excel serials", () => {
    expect(parseDateCell("2026-11-09")).toBe("2026-11-09");
    expect(parseDateCell("11/9/2026")).toBe("2026-11-09");
    expect(parseDateCell(45954)).toBe("2025-10-24");
    expect(parseDateCell("")).toBe(null);
    expect(parseDateCell(null)).toBe(null);
  });

  it("reports an unreadable date instead of guessing", () => {
    expect(parseDateCell("soon").error).toContain("Could not read");
  });
});

const PROPERTIES = [
  { slug: "4800-kent-ave", label: "4800 Kent Ave" },
  { slug: "1900-w-decker", label: "1900 W. Decker" },
];

describe("validateAndPlanWorkPackageImport — packages", () => {
  it("plans creates, and flags a missing title", () => {
    const plan = validateAndPlanWorkPackageImport({
      kind: "packages",
      rows: [
        { title: "Kent kitchen", status: "draft", packageType: "remodel", propertyId: "4800 Kent Ave", plannedStart: "2026-11-10" },
        { title: "   " },
      ],
      existingPackages: [],
      properties: PROPERTIES,
    });
    expect(plan.success).toBe(false);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].fields).toMatchObject({
      title: "Kent kitchen", packageType: "remodel", propertyId: "4800-kent-ave", plannedStart: "2026-11-10",
    });
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].message).toContain("Title is required");
  });

  it("matches an existing package by number for update, and errors on an unknown number", () => {
    const existing = [{ id: "wp_1", code: "WP-0001", title: "Kent kitchen", version: 3 }];
    const plan = validateAndPlanWorkPackageImport({
      kind: "packages",
      rows: [
        { title: "Kent kitchen revised", packageCode: "WP-0001" },
        { title: "Ghost", packageCode: "WP-9999" },
      ],
      existingPackages: existing,
      properties: PROPERTIES,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: "wp_1", matchKind: "code" });
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].message).toContain("No package with number WP-9999 exists");
  });

  it("matches by source record id when source tracking is available", () => {
    const existing = [{
      id: "wp_1", code: "WP-0001", title: "Old title",
      source_system: "sap", source_record_id: "1002345",
    }];
    const plan = validateAndPlanWorkPackageImport({
      kind: "packages",
      rows: [{ title: "New title", sourceRecordId: "1002345" }],
      existingPackages: existing,
      sourceSystem: "sap",
      sourceTrackingAvailable: true,
      properties: PROPERTIES,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].matchKind).toBe("source");
  });

  it("never guesses an ambiguous title match", () => {
    const existing = [
      { id: "wp_1", code: "WP-0001", title: "Kitchen" },
      { id: "wp_2", code: "WP-0002", title: "kitchen" },
    ];
    const plan = validateAndPlanWorkPackageImport({
      kind: "packages",
      rows: [{ title: "Kitchen" }],
      existingPackages: existing,
      properties: PROPERTIES,
    });
    expect(plan.updates).toHaveLength(0);
    expect(plan.errors[0].message).toContain("matches 2 existing packages");
  });

  it("flags an invalid status, scope, property, and a finish before its start", () => {
    const plan = validateAndPlanWorkPackageImport({
      kind: "packages",
      rows: [
        { title: "A", status: "flying" },
        { title: "B", packageType: "teleportation" },
        { title: "C", propertyId: "Nowhere House" },
        { title: "D", plannedStart: "2026-11-10", plannedFinish: "2026-11-01" },
      ],
      existingPackages: [],
      properties: PROPERTIES,
    });
    expect(plan.errors).toHaveLength(4);
  });

  it("flags the same title twice in one file as a duplicate", () => {
    const plan = validateAndPlanWorkPackageImport({
      kind: "packages",
      rows: [{ title: "Same" }, { title: "Same" }],
      existingPackages: [],
      properties: PROPERTIES,
    });
    expect(plan.creates).toHaveLength(1);
    expect(plan.errors).toHaveLength(1);
    expect(plan.errors[0].message).toContain("appears twice");
  });
});

describe("validateAndPlanWorkPackageImport — steps", () => {
  it("matches by sequence number, then title, and validates estimates", () => {
    const existing = [
      { id: "s1", sequenceNo: 1, title: "Fabricate", version: 2 },
      { id: "s2", sequenceNo: 2, title: "Install", version: 1 },
    ];
    const plan = validateAndPlanWorkPackageImport({
      kind: "steps",
      rows: [
        { sequenceNo: "2", title: "Install (revised)", plannedPersonHours: "20" },
        { title: "Paint", craftLabel: "Painter", plannedDurationDays: "3" },
        { title: "Bad days", plannedDurationDays: "0" },
        { title: "Bad hours", plannedPersonHours: "abc" },
      ],
      existingSteps: existing,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toMatchObject({ id: "s2", matchKind: "sequence" });
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].fields).toMatchObject({ title: "Paint", plannedDurationDays: 3 });
    expect(plan.errors).toHaveLength(2);
  });

  it("matches by source record id for steps too", () => {
    const existing = [{
      id: "s1", sequenceNo: 1, title: "Old",
      source_system: "maximo", source_record_id: "WO-88",
    }];
    const plan = validateAndPlanWorkPackageImport({
      kind: "steps",
      rows: [{ title: "New", sourceRecordId: "WO-88" }],
      existingSteps: existing,
      sourceSystem: "maximo",
      sourceTrackingAvailable: true,
    });
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].matchKind).toBe("source");
  });
});
