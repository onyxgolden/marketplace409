import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedFinancialApplication,
} from "@/lib/supabase/createAuthenticatedFinancialApplication";

export async function POST(request: Request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedFinancialApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const {
      user,
      getFinancialApplicationSuite,
    } = authenticatedApplication;

    const body = await request.json();

    const source = body?.source;
    const csv = body?.csv;
    const fileName =
      body?.fileName || "financial-import.csv";

    if (
      typeof source !== "string" ||
      typeof csv !== "string"
    ) {
      return NextResponse.json(
        {
          error:
            "Financial import source and CSV content are required.",
        },
        {
          status: 400,
        },
      );
    }

    const {
      financialImportApplication,
    } = await getFinancialApplicationSuite();

    const result =
      await financialImportApplication.importFile({
        file: {
          name: fileName,
          async text() {
            return csv;
          },
        },
        source,
        ownerId: user.id,
      });

    if (result.error) {
      return NextResponse.json(
        {
          error: result.error,
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(
      "Financial import error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to import financial CSV.";

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
