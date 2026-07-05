import { createFinancialApplicationSuite } from "@/infrastructure/composition";

export async function GET() {
  const { reportingApplication } = await createFinancialApplicationSuite();

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
