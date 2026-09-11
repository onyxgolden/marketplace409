import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { financialDataUnavailableResponse } from "@/lib/financial/financialDataUnavailableResponse";

export async function GET() {
  const authenticatedApplication =
    await createAuthenticatedFinancialApplication();

  if (authenticatedApplication.response) {
    return authenticatedApplication.response;
  }

  const { reportingApplication } =
    await authenticatedApplication.getFinancialApplicationSuite();

  if (!reportingApplication) {
    return financialDataUnavailableResponse();
  }

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
