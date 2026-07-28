import { NextResponse } from "next/server";

import {
  createAuthenticatedFinancialApplication,
} from "@/lib/supabase/createAuthenticatedFinancialApplication";

export async function GET() {
  try {
    const authenticatedApplication =
      await createAuthenticatedFinancialApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const {
      getFinancialApplicationSuite,
    } = authenticatedApplication;

    const {
      financialImportApplication,
    } = await getFinancialApplicationSuite();

    const result =
      await financialImportApplication.initialize();

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(
      "Financial import bootstrap error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to initialize financial import.";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}
