import { DemoFinancialDataProvider, FinancialEngine } from "@/domains/ledger";

export async function GET() {
  try {
    const provider = new DemoFinancialDataProvider();
    const engine = new FinancialEngine(provider.getFinancialData());
    const reports = engine.buildReports();

    return Response.json({
      success: true,
      data: reports,
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
