import {
  DemoFinancialDataProvider,
  FinancialDashboardService,
  FinancialEngine,
} from "@/domains/ledger";

export async function GET() {
  try {
    const provider = new DemoFinancialDataProvider();
    const engine = new FinancialEngine(provider.getFinancialData());
    const reports = engine.buildReports();
    const dashboard = new FinancialDashboardService().buildFromReports(reports);

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
