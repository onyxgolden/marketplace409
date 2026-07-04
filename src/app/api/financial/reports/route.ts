import {
  DemoFinancialDataProvider,
  FinancialDashboardService,
  FinancialEngine,
} from "@/domains/ledger";

export async function GET() {
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
}
