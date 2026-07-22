import {
  NextResponse,
} from "next/server";

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
      financialOperationsApplication,
    } = await authenticatedApplication
      .getFinancialApplicationSuite();

    const operations =
      await financialOperationsApplication
        .buildFinancialOperations();

    return NextResponse.json({
      success: true,
      data: operations,
    });
  } catch (error) {
    console.error(
      "Financial operations error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to build financial operations.";

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
