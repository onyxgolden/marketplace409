import { TraceIntelligenceService } from "../TraceIntelligenceService";

describe("TraceIntelligenceService", () => {
  test("explains trace events with summary, drivers, flow, and risks", () => {
    const resolver = {
      resolveFromReportLine: () => ({
        accountId: "5000",
        financialEvents: [
          {
            id: "event-1",
            description: "Large repair expense",
            amount: 150000,
            normalized_category: "expense",
            tax_deductible: false,
          },
        ],
      }),
    };

    const service = new TraceIntelligenceService(resolver);

    expect(service.explain({ label: "5000" }, {})).toEqual({
      accountId: "5000",
      summary: "Large repair expense affecting account expense",
      drivers: [
        {
          event: "Large repair expense",
          amount: 150000,
          category: "expense",
        },
      ],
      flow: ["FinancialEvent → JournalEntry → Posting → Account → ReportLine"],
      riskFlags: [
        "Large transaction detected",
        "Non-deductible expense detected",
      ],
    });
  });

  test("returns a no-event explanation when trace has no financial events", () => {
    const resolver = {
      resolveFromReportLine: () => ({
        accountId: "4000",
        financialEvents: [],
      }),
    };

    const service = new TraceIntelligenceService(resolver);

    expect(service.explain({ label: "4000" }, {})).toEqual({
      accountId: "4000",
      summary: "No financial events found.",
      drivers: [],
      flow: ["FinancialEvent → JournalEntry → Posting → Account → ReportLine"],
      riskFlags: [],
    });
  });
});
