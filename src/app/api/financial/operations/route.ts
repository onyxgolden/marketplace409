import { NextResponse } from "next/server";

import { createFinancialApplicationSuite } from "@/infrastructure/composition";

export async function GET() {
  try {
    const { financialOperationsApplication } =
      await createFinancialApplicationSuite();

    const operations =
      await financialOperationsApplication.buildFinancialOperations();

    return NextResponse.json({
      success: true,
      data: operations,
    });
  } catch (error) {
    console.error("Financial operations error", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unable to build financial operations.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
