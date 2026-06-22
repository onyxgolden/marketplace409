import { describe, expect, test } from "vitest";

import { CashFlowStatement } from "../../CashFlowStatement";
import { ReportLine } from "../../ReportLine";
import { ReportSection } from "../../sections/ReportSection";
import { CashFlowStatementBuilder } from "../CashFlowStatementBuilder";

describe("CashFlowStatementBuilder", () => {
  test("builds a cash flow statement with activity sections", () => {
    const operatingLine = new ReportLine({
      label: "Net Income",
      amount: 1000,
    });

    const investingLine = new ReportLine({
      label: "Equipment Purchase",
      amount: -500,
    });

    const financingLine = new ReportLine({
      label: "Owner Contribution",
      amount: 750,
    });

    const statement = new CashFlowStatementBuilder().build({
      operatingActivities: [operatingLine],
      investingActivities: [investingLine],
      financingActivities: [financingLine],
    });

    expect(statement).toBeInstanceOf(CashFlowStatement);

    expect(statement.sections()).toHaveLength(3);
    expect(statement.sections()[0]).toBeInstanceOf(ReportSection);

    expect(statement.sections().map((section) => section.name)).toEqual([
      "Operating Activities",
      "Investing Activities",
      "Financing Activities",
    ]);

    expect(statement.lines()).toEqual([
      operatingLine,
      investingLine,
      financingLine,
    ]);
  });

  test("builds empty activity sections by default", () => {
    const statement = new CashFlowStatementBuilder().build();

    expect(statement.sections()).toHaveLength(3);
    expect(statement.lines()).toEqual([]);
  });

  test("requires operating activities to be ReportLine objects", () => {
    expect(() =>
      new CashFlowStatementBuilder().build({
        operatingActivities: [{}],
      })
    ).toThrow(
      "CashFlowStatementBuilder operatingActivities must contain ReportLine objects"
    );
  });

  test("requires investing activities to be ReportLine objects", () => {
    expect(() =>
      new CashFlowStatementBuilder().build({
        investingActivities: [{}],
      })
    ).toThrow(
      "CashFlowStatementBuilder investingActivities must contain ReportLine objects"
    );
  });

  test("requires financing activities to be ReportLine objects", () => {
    expect(() =>
      new CashFlowStatementBuilder().build({
        financingActivities: [{}],
      })
    ).toThrow(
      "CashFlowStatementBuilder financingActivities must contain ReportLine objects"
    );
  });
});
