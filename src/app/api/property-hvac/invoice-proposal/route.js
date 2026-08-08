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
  createAuthenticatedPropertyEvidenceApplication,
} from "@/lib/supabase/createAuthenticatedPropertyEvidenceApplication";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const authenticatedApplication =
      await createAuthenticatedPropertyEvidenceApplication();

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

    const propertyId =
      requiredFormValue(
        formData,
        "propertyId",
      );

    const systemId =
      requiredFormValue(
        formData,
        "systemId",
      );

    if (
      !invoice ||
      typeof invoice.arrayBuffer !==
        "function"
    ) {
      return badRequest(
        "An HVAC invoice PDF is required.",
      );
    }

    if (!propertyId) {
      return badRequest(
        "An HVAC invoice property id is required.",
      );
    }

    if (!systemId) {
      return badRequest(
        "An HVAC invoice system id is required.",
      );
    }

    const bytes =
      await invoice.arrayBuffer();

    const extraction =
      await extractHVACInvoiceText({
        bytes,
        contentType:
          invoice.type,
      });

    const {
      application,
      user,
    } = authenticatedApplication;

    if (extraction.requiresOCR) {
      const evidence =
        await application.preserve({
          ownerId:
            user.id,
          propertyId,
          hvacSystemId:
            systemId,
          bytes,
          originalFilename:
            invoice.name ||
            "hvac-invoice.pdf",
          mimeType:
            invoice.type,
          extractionMethod:
            "pending",
          parserVersion:
            null,
          reviewStatus:
            "pending_review",
        });

      return NextResponse.json(
        {
          success: false,
          ocrRequired: true,
          extractionMethod:
            extraction
              .extractionMethod,
          evidence:
            evidenceReference(
              evidence,
            ),
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

    const evidence =
      await application.preserve({
        ownerId:
          user.id,
        propertyId,
        hvacSystemId:
          systemId,
        bytes,
        originalFilename:
          invoice.name ||
          "hvac-invoice.pdf",
        mimeType:
          invoice.type,
        extractionMethod:
          extraction
            .extractionMethod,
        parserVersion:
          proposal.parserVersion,
        reviewStatus:
          "pending_review",
      });

    return NextResponse.json({
      success: true,
      proposal,
      evidence:
        evidenceReference(
          evidence,
        ),
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
      ) ||
      message.includes(
        "must be a PDF, JPEG, or PNG",
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

function requiredFormValue(
  formData,
  name,
) {
  const value =
    formData.get(name);

  return typeof value ===
    "string"
    ? value.trim()
    : "";
}

function evidenceReference(
  evidence,
) {
  return Object.freeze({
    id:
      evidence.id,
    originalFilename:
      evidence.originalFilename,
    reviewStatus:
      evidence.reviewStatus,
  });
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
