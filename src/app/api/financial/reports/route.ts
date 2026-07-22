import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

export async function GET() {
  const authenticatedApplication =
    await createAuthenticatedFinancialApplication();

  if (authenticatedApplication.response) {
    return authenticatedApplication.response;
  }

  const { reportingApplication } =
    await authenticatedApplication.getFinancialApplicationSuite();

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
