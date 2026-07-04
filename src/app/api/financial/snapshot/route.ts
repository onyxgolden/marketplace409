import { FinancialEngine } from "@/domains/ledger";
import { createDemoFinancialData } from "@/domains/ledger/demoFinancialData";

export async function GET() {
  try {
    const engine = new FinancialEngine(createDemoFinancialData());
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
