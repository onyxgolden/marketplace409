import { NextResponse } from "next/server";

import { createFinancialApplicationSuite } from "@/infrastructure/composition";

type TraceRequestBody = Readonly<{
  reportLine?: unknown;
  ledgerContext?: unknown;
}>;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TraceRequestBody;

    if (!isRecord(body.reportLine)) {
      return NextResponse.json(
        { error: "reportLine is required." },
        { status: 400 },
      );
    }

    const { explainabilityApplication } =
      await createFinancialApplicationSuite();

    const trace = explainabilityApplication.traceReportLine(
      body.reportLine,
      isRecord(body.ledgerContext) ? body.ledgerContext : {},
    );

    return NextResponse.json({
      success: true,
      data: {
        trace,
      },
    });
  } catch (error) {
    console.error("Financial trace error", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to trace financial report line.";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
