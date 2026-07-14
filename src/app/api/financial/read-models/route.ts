import { NextResponse } from "next/server";

import { createFinancialApplicationSuite } from "@/infrastructure/composition";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const { readModelApplication } =
      await createFinancialApplicationSuite();

    const [business, investor, kpi, executive] = await Promise.all([
      searchParams.get("business") === "true"
        ? readModelApplication.buildBusinessDashboard()
        : Promise.resolve(null),
      searchParams.get("investor") === "true"
        ? readModelApplication.buildInvestorDashboard()
        : Promise.resolve(null),
      searchParams.get("kpi") === "true"
        ? readModelApplication.buildKPIModel()
        : Promise.resolve(null),
      searchParams.get("executive") === "true"
        ? readModelApplication.buildExecutiveSummary()
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        business,
        investor,
        kpi,
        executive,
      },
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
