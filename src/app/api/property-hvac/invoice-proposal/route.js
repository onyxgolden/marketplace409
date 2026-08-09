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
  GoogleCloudVisionOCRAdapter,
} from "@/infrastructure/ocr/GoogleCloudVisionOCRAdapter";

import {
  createAuthenticatedPropertyEvidenceApplication,
} from "@/lib/supabase/createAuthenticatedPropertyEvidenceApplication";

export const runtime = "nodejs";

const PDF_MIME_TYPE =
  "application/pdf";

const OCR_IMAGE_MIME_TYPES =
  Object.freeze([
    "image/jpeg",
    "image/png",
  ]);

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

    const uploadedBytes =
      await invoice.arrayBuffer();

    // Consumers may detach their input buffer.
    const extractionBytes =
      uploadedBytes.slice(0);

    const evidenceBytes =
      uploadedBytes.slice(0);

    const mimeType =
      String(
        invoice.type || "",
      )
        .trim()
        .toLowerCase();

    if (
      mimeType !==
        PDF_MIME_TYPE &&
      !OCR_IMAGE_MIME_TYPES
        .includes(
          mimeType,
        )
    ) {
      return badRequest(
        "An HVAC invoice must be a PDF, JPEG, or PNG file.",
      );
    }

    const extraction =
      mimeType ===
        PDF_MIME_TYPE
        ? await extractHVACInvoiceText({
            bytes: extractionBytes,
            contentType:
              mimeType,
          })
        : {
            text: "",
            totalPages: 1,
            extractionMethod:
              "ocr_required",
            requiresOCR: true,
          };

    const {
      application,
      user,
    } = authenticatedApplication;

    if (extraction.requiresOCR) {
      try {
        const ocr =
          await new GoogleCloudVisionOCRAdapter()
            .extractText({
              bytes: extractionBytes,
              mimeType,
            });

        if (
          ocr.text.length < 40
        ) {
          throw new Error(
            "Google Vision did not find enough readable invoice text.",
          );
        }

        const proposal =
          parseHVACInvoiceText(
            ocr.text,
          );

        const evidence =
          await application.preserve({
            ownerId:
              user.id,
            propertyId,
            hvacSystemId:
              systemId,
            bytes: evidenceBytes,
            originalFilename:
              invoice.name ||
              "hvac-invoice.pdf",
            mimeType,
            extractionMethod:
              ocr.extractionMethod,
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
              ocr.extractionMethod,
            totalPages:
              ocr.totalPages,
            processedPages:
              ocr.processedPages,
            truncated:
              ocr.truncated,
          },
        });
      } catch (ocrError) {
        const evidence =
          await application.preserve({
            ownerId:
              user.id,
            propertyId,
            hvacSystemId:
              systemId,
            bytes: evidenceBytes,
            originalFilename:
              invoice.name ||
              "hvac-invoice.pdf",
            mimeType,
            extractionMethod:
              "pending",
            parserVersion:
              null,
            reviewStatus:
              "extraction_failed",
          });

        return NextResponse.json(
          {
            success: false,
            ocrRequired: true,
            extractionMethod:
              "google_cloud_vision",
            evidence:
              evidenceReference(
                evidence,
              ),
            error:
              ocrError instanceof
                Error
                ? ocrError.message
                : "Google Vision could not read this invoice.",
          },
          {
            status: 422,
          },
        );
      }
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
        bytes: evidenceBytes,
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
        processedPages:
          extraction.totalPages,
        truncated: false,
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
