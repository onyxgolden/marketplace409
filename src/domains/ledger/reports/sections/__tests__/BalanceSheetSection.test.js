import { describe, expect, test } from "vitest";
import { BalanceSheetSection } from "../BalanceSheetSection";
import { ReportLine } from "../../ReportLine";

describe("BalanceSheetSection", () => {
  test("creates an immutable balance sheet section", () => {
    const section = new BalanceSheetSection({
      name: "Assets",
      lines: [
        new ReportLine({
          label: "Cash",
          amount: 1000,
        }),
      ],
    });

    expect(section.name).toBe("Assets");
    expect(section.lines()).toEqual([
      new ReportLine({
        label: "Cash",
        amount: 1000,
      }),
    ]);

    expect(Object.isFrozen(section)).toBe(true);
  });
});
