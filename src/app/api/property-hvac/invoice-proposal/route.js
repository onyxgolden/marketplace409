import {
  NextResponse,
} from "next/server";

import {
  extractHVACInvoiceText,
} from "@/application/property-hvac/extractHVACInvoiceText";

import {
  parseHVACInvoiceText,
} from "@/application/property-hvac/parseHVACInvoiceText";

import {
  createAuthenticatedPropertyHVACApplication,
} from "@/lib/supabase/createAuthenticatedPropertyHVACApplication";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedPropertyHVACApplication();

    if (
      authenticatedApplication.response
    ) {
      return authenticatedApplication
        .response;
    }

    const formData =
      await request.formData();

    const invoice =
      formData.get("invoice");

    if (
      !invoice ||
      typeof invoice.arrayBuffer !==
        "function"
    ) {
      return badRequest(
        "An HVAC invoice PDF is required.",
      );
    }

    const extraction =
      await extractHVACInvoiceText({
        bytes:
          await invoice.arrayBuffer(),
        contentType:
          invoice.type,
      });

    if (extraction.requiresOCR) {
      return NextResponse.json(
        {
          success: false,
          ocrRequired: true,
          extractionMethod:
            extraction
              .extractionMethod,
          error:
            "This PDF does not contain enough readable text. OCR is required.",
        },
        {
          status: 422,
        },
      );
    }

    const proposal =
      parseHVACInvoiceText(
        extraction.text,
      );

    return NextResponse.json({
      success: true,
      proposal,
      extraction: {
        method:
          extraction
            .extractionMethod,
        totalPages:
          extraction.totalPages,
      },
    });
  } catch (error) {
    console.error(
      "HVAC invoice proposal error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to process the HVAC invoice.";

    const status =
      message.includes(
        "must be a PDF",
      ) ||
      message.includes(
        "is empty",
      ) ||
      message.includes(
        "must not exceed",
      )
        ? 400
        : 500;

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status,
      },
    );
  }
}

function badRequest(message) {
  return NextResponse.json(
    {
      success: false,
      error: message,
    },
    {
      status: 400,
    },
  );
}
