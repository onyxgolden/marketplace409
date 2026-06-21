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
});
