import { describe, expect, test } from "vitest";

import { CashFlowStatement } from "../CashFlowStatement";
import { ReportLine } from "../ReportLine";
import { ReportSection } from "../sections/ReportSection";

describe("CashFlowStatement", () => {
  test("creates a cash flow statement from report sections", () => {
    const operating = new ReportSection({
      name: "Operating Activities",
      lines: [
        new ReportLine({
          label: "Net Income",
          amount: 1000,
        }),
      ],
    });

    const investing = new ReportSection({
      name: "Investing Activities",
      lines: [
        new ReportLine({
          label: "Equipment Purchase",
          amount: -500,
        }),
      ],
    });

    const financing = new ReportSection({
      name: "Financing Activities",
      lines: [
        new ReportLine({
          label: "Owner Contribution",
          amount: 750,
        }),
      ],
    });

    const statement = new CashFlowStatement({
      sections: [operating, investing, financing],
    });

    expect(statement.sections()).toEqual([
      operating,
      investing,
      financing,
    ]);

    expect(statement.lines()).toHaveLength(3);

    expect(statement.lines().map((line) => line.label)).toEqual([
      "Net Income",
      "Equipment Purchase",
      "Owner Contribution",
    ]);
  });
});
