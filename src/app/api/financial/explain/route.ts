import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";

type ExplainRequestBody = Readonly<{
  query?: unknown;
  reportLine?: unknown;
  ledgerContext?: unknown;
}>;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ExplainRequestBody;

    if (!isNonEmptyString(body.query)) {
      return NextResponse.json(
        { error: "query is required." },
        { status: 400 },
      );
    }

    if (!isRecord(body.reportLine)) {
      return NextResponse.json(
        { error: "reportLine is required." },
        { status: 400 },
      );
    }

    const authenticatedApplication =
      await createAuthenticatedFinancialApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const { explainabilityApplication } =
      await authenticatedApplication.getFinancialApplicationSuite();

    const explanation =
      explainabilityApplication.explainCanonicalReportLine(
        body.query,
        body.reportLine,
      );

    return NextResponse.json({
      success: true,
      data: {
        explanation,
      },
    });
  } catch (error) {
    console.error("Financial explanation error", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to explain financial report line.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
