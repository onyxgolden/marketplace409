import { TraceExplorerService } from "../TraceExplorerService";

describe("TraceExplorerService", () => {
  test("converts resolver trace into UI-ready graph structure", () => {
    const resolver = {
      resolveFromReportLine: () => ({
        accountId: "4000",
        postings: [
          {
            id: "posting-1",
            accountId: "4000",
            amount: { amount: 120000 },
          },
        ],
        financialEvents: [
          {
            id: "event-1",
            event_date: "2026-07-04",
            description: "Rent payment",
            amount: 120000,
            source_system: "bank",
          },
        ],
        sourceRecordIds: ["bank-row-1"],
      }),
    };

    const service = new TraceExplorerService(resolver);

    expect(
      service.exploreReportLine({ label: "4000", amount: 120000 }, {})
    ).toEqual({
      node: {
        type: "reportLine",
        accountId: "4000",
      },
      children: [
        {
          type: "postings",
          items: [
            {
              id: "posting-1",
              accountId: "4000",
              amount: { amount: 120000 },
            },
          ],
        },
        {
          type: "financialEvents",
          items: [
            {
              id: "event-1",
              date: "2026-07-04",
              description: "Rent payment",
              amount: 120000,
              sourceSystem: "bank",
            },
          ],
        },
        {
          type: "sourceRecords",
          items: [
            {
              source_record_id: "bank-row-1",
            },
          ],
        },
      ],
    });
  });
});
