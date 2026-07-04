import { FinancialEngine } from "@/domains/ledger";
import { createDemoFinancialData } from "@/domains/ledger/demoFinancialData";

export async function GET() {
  const engine = new FinancialEngine(createDemoFinancialData());

  return Response.json({
    success: true,
    data: engine.buildReports(),
  });
}
