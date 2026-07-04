import { createFinancialApplicationSuite } from "@/infrastructure/composition";

export async function GET() {
  const { reportingApplication } = createFinancialApplicationSuite();

  const { reports, dashboard } =
    reportingApplication.buildDashboardReports();

  return Response.json({
    success: true,
    data: {
      reports,
      dashboard,
    },
  });
}
