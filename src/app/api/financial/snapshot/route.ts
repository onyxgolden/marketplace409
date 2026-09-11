import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { financialDataUnavailableResponse } from "@/lib/financial/financialDataUnavailableResponse";

export async function GET() {
  try {
    const authenticatedApplication =
      await createAuthenticatedFinancialApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const { snapshotApplication } =
      await authenticatedApplication.getFinancialApplicationSuite();

    if (!snapshotApplication) {
      return financialDataUnavailableResponse();
    }

    const { reports, dashboard } =
      await snapshotApplication.captureDashboardSnapshot();

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
      { status: 500 },
    );
  }
}
