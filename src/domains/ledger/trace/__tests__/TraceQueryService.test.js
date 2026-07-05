import { TraceQueryService } from "../TraceQueryService";

describe("TraceQueryService", () => {
  test("answers why questions with trace insight summary", () => {
    const resolver = {
      resolveFromReportLine: () => ({
        accountId: "4000",
        postings: [],
        financialEvents: [],
        sourceRecordIds: [],
      }),
    };

    const intelligence = {
      explain: () => ({
        summary: "Rent payment affecting account revenue",
        drivers: [{ event: "Rent payment", amount: 120000, category: "revenue" }],
        riskFlags: [],
      }),
    };

    const service = new TraceQueryService(resolver, intelligence);

    expect(service.ask("Why did revenue increase?", { label: "4000" }, {})).toEqual({
      query: "Why did revenue increase?",
      answer: "Rent payment affecting account revenue",
      drivers: [{ event: "Rent payment", amount: 120000, category: "revenue" }],
      riskFlags: [],
      trace: {
        accountId: "4000",
        postings: [],
        financialEvents: [],
        sourceRecordIds: [],
      },
    });
  });

  test("requires a query", () => {
    const service = new TraceQueryService();

    expect(() => service.ask("", { label: "4000" }, {})).toThrow(
      "Query required"
    );
  });
});
