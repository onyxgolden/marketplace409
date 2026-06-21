import { describe, expect, test } from "vitest";
import { ReportLine } from "../ReportLine";

describe("ReportLine", () => {
  test("creates an immutable report line", () => {
    const line = new ReportLine({
      label: "Cash",
      amount: 1000,
    });

    expect(line.label).toBe("Cash");
    expect(line.amount).toBe(1000);
    expect(Object.isFrozen(line)).toBe(true);
  });

  test("requires a non-empty label", () => {
    expect(() => new ReportLine({ label: "", amount: 1000 })).toThrow(
      "ReportLine requires a label"
    );

    expect(() => new ReportLine({ label: "   ", amount: 1000 })).toThrow(
      "ReportLine requires a label"
    );
  });

  test("requires amount to be a finite number", () => {
    expect(() => new ReportLine({ label: "Cash", amount: "1000" })).toThrow(
      "ReportLine amount must be a finite number"
    );

    expect(() => new ReportLine({ label: "Cash", amount: NaN })).toThrow(
      "ReportLine amount must be a finite number"
    );

    expect(() => new ReportLine({ label: "Cash", amount: Infinity })).toThrow(
      "ReportLine amount must be a finite number"
    );
  });
});

