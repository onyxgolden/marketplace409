import { describe, expect, test } from "vitest";
import { ReportLine } from "../../ReportLine";
import { ReportSection } from "../ReportSection";

describe("ReportSection", () => {
  test("creates an immutable report section with a name and report lines", () => {
    const line = new ReportLine({
      label: "Cash",
      amount: 100,
    });

    const section = new ReportSection({
      name: "Assets",
      lines: [line],
    });

    expect(section.name).toBe("Assets");
    expect(section.lines()).toEqual([line]);
    expect(Object.isFrozen(section)).toBe(true);
  });

  test("requires a name", () => {
    expect(() => new ReportSection({ name: "" })).toThrow(
      "ReportSection requires a name"
    );
  });

  test("requires lines to be ReportLine objects", () => {
    expect(
      () =>
        new ReportSection({
          name: "Assets",
          lines: [{ label: "Cash", amount: 100 }],
        })
    ).toThrow("ReportSection lines must be ReportLine objects");
  });

  test("protects section lines from outside mutation", () => {
    const line = new ReportLine({
      label: "Cash",
      amount: 100,
    });

    const lines = [line];

    const section = new ReportSection({
      name: "Assets",
      lines,
    });

    lines.push(
      new ReportLine({
        label: "Inventory",
        amount: 200,
      })
    );

    expect(section.lines()).toEqual([line]);
  });
});
