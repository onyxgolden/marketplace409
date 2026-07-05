import { NextResponse } from "next/server";

import { createFinancialApplicationSuite } from "@/infrastructure/composition";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const { readModelApplication } = await createFinancialApplicationSuite();

    const data = {
      business:
        searchParams.get("business") === "true"
          ? readModelApplication.buildBusinessDashboard()
          : null,
      investor:
        searchParams.get("investor") === "true"
          ? readModelApplication.buildInvestorDashboard()
          : null,
      kpi:
        searchParams.get("kpi") === "true"
          ? readModelApplication.buildKPIModel()
          : null,
      executive:
        searchParams.get("executive") === "true"
          ? readModelApplication.buildExecutiveSummary()
          : null,
    };

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Financial read models error", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to build financial read models.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
