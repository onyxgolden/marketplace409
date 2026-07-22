import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedFinancialApplication,
} from "@/lib/supabase/createAuthenticatedFinancialApplication";

export async function GET(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedFinancialApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const {
      searchParams,
    } = new URL(request.url);

    const decisionOutcomeRequested =
      searchParams.get("decisionOutcome") ===
      "true";

    const decisionId =
      searchParams.get("decisionId");

    if (
      decisionOutcomeRequested &&
      (
        typeof decisionId !== "string" ||
        decisionId.trim().length === 0
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Decision id is required when decisionOutcome=true.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      readModelApplication,
    } = await authenticatedApplication
      .getFinancialApplicationSuite();

    const [
      financial,
      business,
      investor,
      kpi,
      executive,
      decisionOutcome,
    ] = await Promise.all([
      searchParams.get("financial") ===
      "true"
        ? readModelApplication
            .buildFinancialDashboard()
        : Promise.resolve(null),

      searchParams.get("business") ===
      "true"
        ? readModelApplication
            .buildBusinessDashboard()
        : Promise.resolve(null),

      searchParams.get("investor") ===
      "true"
        ? readModelApplication
            .buildInvestorDashboard()
        : Promise.resolve(null),

      searchParams.get("kpi") === "true"
        ? readModelApplication
            .buildKPIModel()
        : Promise.resolve(null),

      searchParams.get("executive") ===
      "true"
        ? readModelApplication
            .buildExecutiveSummary()
        : Promise.resolve(null),

      decisionOutcomeRequested
        ? readModelApplication
            .buildDecisionOutcome(
              decisionId.trim(),
            )
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        financial,
        business,
        investor,
        kpi,
        executive,
        decisionOutcome,
      },
    });
  } catch (error) {
    console.error("Financial read models error", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to build financial read models.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
