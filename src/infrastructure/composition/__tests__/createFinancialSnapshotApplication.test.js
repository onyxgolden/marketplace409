import { createFinancialSnapshotApplication } from "../createFinancialSnapshotApplication.js";
import { DemoFinancialDataProvider } from "../../../domains/ledger/index.js";

describe("createFinancialSnapshotApplication", () => {
  test("does not implicitly select demo financial data: reportingApplication and snapshotApplication are null when nothing is configured", async () => {
    const suite = await createFinancialSnapshotApplication({
      snapshotRepository: {
        save: vi.fn(async () => {}),
        findLatestByOwnerId: vi.fn(async () => null),
      },
    });

    // Canary: if `options.provider || new DemoFinancialDataProvider()` (or an equivalent
    // implicit fallback) is reintroduced here, these assertions fail.
    expect(suite.reportingApplication).toBeNull();
    expect(suite.snapshotApplication).toBeNull();
  });

  test("resolves a real, non-demo suite when an explicit provider is injected", async () => {
    const suite = await createFinancialSnapshotApplication({
      provider: new DemoFinancialDataProvider(),
      snapshotRepository: {
        save: vi.fn(async () => {}),
        findLatestByOwnerId: vi.fn(async () => null),
      },
    });

    expect(suite.reportingApplication).not.toBeNull();
    expect(suite.snapshotApplication).not.toBeNull();

    const snapshot = await suite.snapshotApplication.captureDashboardSnapshot();
    expect(snapshot.dashboard).toBeDefined();
  });

  test("resolves a real, non-demo suite when explicit financialData is injected directly", async () => {
    const financialData = new DemoFinancialDataProvider().getFinancialData();

    const suite = await createFinancialSnapshotApplication({
      financialData,
      snapshotRepository: {
        save: vi.fn(async () => {}),
        findLatestByOwnerId: vi.fn(async () => null),
      },
    });

    expect(suite.reportingApplication).not.toBeNull();
    expect(suite.snapshotApplication).not.toBeNull();
  });
});
