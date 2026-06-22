import { describe, expect, test } from "vitest";

import { StatementOfOwnersEquity } from "../StatementOfOwnersEquity";
import { ReportLine } from "../ReportLine";
import { ReportSection } from "../sections/ReportSection";

describe("StatementOfOwnersEquity", () => {
  test("creates a statement of owner's equity from report sections", () => {
    const beginningEquity = new ReportSection({
      name: "Beginning Equity",
      lines: [
        new ReportLine({
          label: "Beginning Owner's Capital",
          amount: 1000,
        }),
      ],
    });

    const changes = new ReportSection({
      name: "Changes in Equity",
      lines: [
        new ReportLine({
          label: "Owner Contribution",
          amount: 500,
        }),
        new ReportLine({
          label: "Owner Draw",
          amount: -200,
        }),
        new ReportLine({
          label: "Net Income",
          amount: 700,
        }),
      ],
    });

    const endingEquity = new ReportSection({
      name: "Ending Equity",
      lines: [
        new ReportLine({
          label: "Ending Owner's Capital",
          amount: 2000,
        }),
      ],
    });

    const statement = new StatementOfOwnersEquity({
      sections: [beginningEquity, changes, endingEquity],
    });

    expect(statement.sections()).toEqual([
      beginningEquity,
      changes,
      endingEquity,
    ]);

    expect(statement.lines()).toHaveLength(5);

    expect(statement.lines().map((line) => line.label)).toEqual([
      "Beginning Owner's Capital",
      "Owner Contribution",
      "Owner Draw",
      "Net Income",
      "Ending Owner's Capital",
    ]);
  });
});
