import {
  DemoFinancialDataProvider,
  FinancialDashboardService,
  FinancialEngine,
  SnapshotHistoryService,
} from "@/domains/ledger";
import { createFinancialSnapshotRepository } from "@/infrastructure/composition";

export async function GET() {
  try {
    const provider = new DemoFinancialDataProvider();
    const engine = new FinancialEngine(provider.getFinancialData());
    const reports = engine.buildReports();
    const dashboard = new FinancialDashboardService().buildFromReports(reports);

    const repository = await createFinancialSnapshotRepository();
    const historyService = new SnapshotHistoryService(repository);

    await historyService.captureDashboardSnapshot({
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      period: {
        start: null,
        end: null,
      },
      dashboard,
    });

    return Response.json({
      success: true,
      data: {
        reports,
        dashboard,
      },
    });
  } catch (error: any) {
    return Response.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
