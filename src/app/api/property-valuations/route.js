import {
  NextResponse,
} from "next/server";

import {
  createAuthenticatedPropertyValuationApplication,
} from "@/lib/supabase/createAuthenticatedPropertyValuationApplication";

export async function POST(request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedPropertyValuationApplication();

    if (authenticatedApplication.response) {
      return authenticatedApplication.response;
    }

    const body =
      await request.json();

    const {
      application,
      user,
    } = authenticatedApplication;

    switch (body?.operation) {
      case "record-manual": {
        if (!isObject(body.valuation)) {
          return badRequest(
            "valuation is required.",
          );
        }

        const valuation =
          await application.recordManual(
            body.valuation,
            user.id,
          );

        return NextResponse.json({
          success: true,
          valuation,
        });
      }

      case "preview-spreadsheet": {
        if (!Array.isArray(body.rows)) {
          return badRequest(
            "rows must be an array.",
          );
        }

        const preview =
          application.previewSpreadsheetRows(
            body.rows,
          );

        return NextResponse.json({
          success: true,
          preview,
        });
      }

      case "import-spreadsheet": {
        if (!Array.isArray(body.rows)) {
          return badRequest(
            "rows must be an array.",
          );
        }

        const result =
          await application.importSpreadsheetRows(
            body.rows,
            user.id,
          );

        return NextResponse.json({
          success:
            result.valid,
          result,
        });
      }

      default:
        return badRequest(
          "A supported property valuation operation is required.",
        );
    }
  } catch (error) {
    console.error(
      "Property valuation operation error",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete the property valuation operation.",
      },
      {
        status: 500,
      },
    );
  }
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function badRequest(message) {
  return NextResponse.json(
    {
      error:
        message,
    },
    {
      status: 400,
    },
  );
}
