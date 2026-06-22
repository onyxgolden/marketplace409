import { describe, expect, test } from "vitest";
import { ReportLine } from "../../ReportLine";
import { ReportSection } from "../../sections/ReportSection";
import { ReportSectionBuilder } from "../ReportSectionBuilder";

describe("ReportSectionBuilder", () => {
  test("builds a report section from report lines", () => {
    const lines = [
      new ReportLine({ label: "Cash", amount: 100 }),
      new ReportLine({ label: "Revenue", amount: -100 }),
    ];

    const section = new ReportSectionBuilder().build({
      name: "Accounts",
      lines,
    });

    expect(section).toEqual(
      new ReportSection({
        name: "Accounts",
        lines,
      })
    );
  });

  test("requires lines to be ReportLine objects", () => {
    expect(() =>
      new ReportSectionBuilder().build({
        name: "Bad Section",
        lines: [{ label: "Cash", amount: 100 }],
      })
    ).toThrow("ReportSectionBuilder lines must be ReportLine objects");
  });
});
