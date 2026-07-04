import { DemoFinancialDataProvider, FinancialEngine } from "@/domains/ledger";

export async function GET() {
  const provider = new DemoFinancialDataProvider();
  const engine = new FinancialEngine(provider.getFinancialData());

  return Response.json({
    success: true,
    data: engine.buildReports(),
  });
}
