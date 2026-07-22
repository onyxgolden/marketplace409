import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

type DashboardIntelligenceRequestBody = Readonly<{
  ledgerContext?: unknown;
  assets?: unknown;
  liabilities?: unknown;
}>;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DashboardIntelligenceRequestBody;

    const authenticatedApplication =
      await createAuthenticatedFinancialApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const { dashboardIntelligenceApplication } =
      await authenticatedApplication.getFinancialApplicationSuite();

    const intelligence =
      dashboardIntelligenceApplication.buildDashboardIntelligence({
        ledgerContext: isRecord(body.ledgerContext) ? body.ledgerContext : {},
        assets: Array.isArray(body.assets) ? body.assets : [],
        liabilities: Array.isArray(body.liabilities) ? body.liabilities : [],
      });

    return NextResponse.json({
      success: true,
      data: intelligence,
    });
  } catch (error) {
    console.error("Financial dashboard intelligence error", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to build financial dashboard intelligence.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
