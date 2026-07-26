import { FinancialExplainabilityApplication } from "./FinancialExplainabilityApplication.js";

describe("FinancialExplainabilityApplication", () => {
  test("delegates report trace requests to the trace explorer service", () => {
    const expected = { node: { type: "reportLine" } };

    const traceExplorerService = {
      exploreReportLine: vi.fn(() => expected),
    };

    const traceQueryService = {
      ask: vi.fn(),
    };

    const application = new FinancialExplainabilityApplication({
      traceExplorerService,
      traceQueryService,
    });

    expect(
      application.traceReportLine(
        { label: "4000" },
        { ledger: "context" },
      ),
    ).toBe(expected);

    expect(traceExplorerService.exploreReportLine).toHaveBeenCalledWith(
      { label: "4000" },
      { ledger: "context" },
    );
  });

  test("delegates explanation requests to the trace query service", () => {
    const expected = { answer: "Because revenue increased." };

    const traceExplorerService = {
      exploreReportLine: vi.fn(),
    };

    const traceQueryService = {
      ask: vi.fn(() => expected),
    };

    const application = new FinancialExplainabilityApplication({
      traceExplorerService,
      traceQueryService,
    });

    expect(
      application.explainReportLine(
        "Why did revenue increase?",
        { label: "4000" },
        { ledger: "context" },
      ),
    ).toBe(expected);

    expect(traceQueryService.ask).toHaveBeenCalledWith(
      "Why did revenue increase?",
      { label: "4000" },
      { ledger: "context" },
    );
  });


  test("uses canonical projection for trace requests", () => {
    const expected = { node: { type: "canonical" } };

    const traceExplorerService = {
      exploreReportLine: vi.fn(() => expected),
    };

    const traceQueryService = {
      ask: vi.fn(),
    };

    const canonicalExplainabilityProjection = {
      project: vi.fn(() => ({
        ledgerContext: {
          ledger: "canonical-ledger",
        },
      })),
    };

    const generalLedger = {
      entries: [],
    };

    const application = new FinancialExplainabilityApplication({
      traceExplorerService,
      traceQueryService,
      canonicalExplainabilityProjection,
      generalLedger,
    });

    expect(
      application.traceCanonicalReportLine(
        { label: "4000" },
        { repositoryBacked: true },
      ),
    ).toBe(expected);

    expect(
      canonicalExplainabilityProjection.project,
    ).toHaveBeenCalledWith({
      context: { repositoryBacked: true },
      ledger: generalLedger,
    });

    expect(
      traceExplorerService.exploreReportLine,
    ).toHaveBeenCalledWith(
      { label: "4000" },
      { ledger: "canonical-ledger" },
    );
  });

  test("uses canonical projection for explanation requests", () => {
    const expected = { answer: "canonical explanation" };

    const traceExplorerService = {
      exploreReportLine: vi.fn(),
    };

    const traceQueryService = {
      ask: vi.fn(() => expected),
    };

    const canonicalExplainabilityProjection = {
      project: vi.fn(() => ({
        ledgerContext: {
          ledger: "canonical-ledger",
        },
      })),
    };

    const generalLedger = {
      entries: [],
    };

    const application = new FinancialExplainabilityApplication({
      traceExplorerService,
      traceQueryService,
      canonicalExplainabilityProjection,
      generalLedger,
    });

    expect(
      application.explainCanonicalReportLine(
        "Why?",
        { label: "4000" },
        { repositoryBacked: true },
      ),
    ).toBe(expected);

    expect(
      traceQueryService.ask,
    ).toHaveBeenCalledWith(
      "Why?",
      { label: "4000" },
      { ledger: "canonical-ledger" },
    );
  });

  test("requires a trace explorer service", () => {
    expect(
      () =>
        new FinancialExplainabilityApplication({
          traceQueryService: {},
        }),
    ).toThrow(
      "FinancialExplainabilityApplication requires a trace explorer service.",
    );
  });

  test("requires a trace query service", () => {
    expect(
      () =>
        new FinancialExplainabilityApplication({
          traceExplorerService: {},
        }),
    ).toThrow(
      "FinancialExplainabilityApplication requires a trace query service.",
    );
  });
});
