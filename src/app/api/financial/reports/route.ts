import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import { financialDataUnavailableResponse } from "@/lib/financial/financialDataUnavailableResponse";
import { expandMonths } from "@/domains/ledger/reports/comparativePeriods.js";
import { buildComparativeIncomeStatements } from "@/domains/ledger/reports/buildComparativeIncomeStatements.js";

export async function GET(request: Request) {
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

  // ?compare=2026-06,2026-07,2026-08 -- a comparative month-over-month P&L.
  // Without it, the dashboard report payload is returned exactly as before.
  const compareParam = new URL(request.url).searchParams.get("compare");

  if (compareParam !== null) {
    let periods;

    try {
      periods = expandMonths(
        compareParam
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean),
      );
    } catch (error) {
      return Response.json(
        {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Invalid compare parameter: expected comma-separated YYYY-MM month keys (max 12).",
        },
        { status: 400 },
      );
    }

    const periods_ = buildComparativeIncomeStatements({
      engine: reportingApplication.engine,
      periods,
    });

    return Response.json({
      success: true,
      data: {
        periods: periods_,
      },
    });
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
