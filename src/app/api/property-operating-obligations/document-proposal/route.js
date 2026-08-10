import {
  NextResponse,
} from "next/server";

import {
  extractPropertyOperatingDocumentText,
} from "@/application/property-operating-obligation/extractPropertyOperatingDocumentText";

import {
  parsePropertyOperatingDocumentText,
} from "@/application/property-operating-obligation/parsePropertyOperatingDocumentText";

import {
  GoogleCloudVisionOCRAdapter,
} from "@/infrastructure/ocr/GoogleCloudVisionOCRAdapter";

import {
  createAuthenticatedPropertyEvidenceApplication,
} from "@/lib/supabase/createAuthenticatedPropertyEvidenceApplication";

export const runtime =
  "nodejs";

const PDF_MIME_TYPE =
  "application/pdf";

const OCR_IMAGE_MIME_TYPES =
  Object.freeze([
    "image/jpeg",
    "image/png",
  ]);

export async function POST(
  request,
) {
  try {
    const authenticated =
      await createAuthenticatedPropertyEvidenceApplication();

    if (
      authenticated.response
    ) {
      return authenticated
        .response;
    }

    const formData =
      await request.formData();
    const document =
      formData.get(
        "document",
      );
    const propertyId =
      requiredFormValue(
        formData,
        "propertyId",
      );

    if (
      !document ||
      typeof document
        .arrayBuffer !==
        "function"
    ) {
      return badRequest(
        "A property tax or insurance document is required.",
      );
    }

    if (!propertyId) {
      return badRequest(
        "A property operating document property id is required.",
      );
    }

    const uploadedBytes =
      await document
        .arrayBuffer();

    // Extraction and OCR libraries may detach their input buffers.
    // Each consumer receives an independent copy so preserved evidence
    // and OCR fallback remain readable.
    const extractionBytes =
      uploadedBytes.slice(0);
    const ocrBytes =
      uploadedBytes.slice(0);
    const evidenceBytes =
      uploadedBytes.slice(0);
    const mimeType =
      String(
        document.type || "",
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
        "A property operating document must be a PDF, JPEG, or PNG file.",
      );
    }

    const extraction =
      mimeType ===
        PDF_MIME_TYPE
        ? await extractPropertyOperatingDocumentText({
            bytes:
              extractionBytes,
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
    } = authenticated;

    if (
      extraction.requiresOCR
    ) {
      try {
        const ocr =
          await new GoogleCloudVisionOCRAdapter()
            .extractText({
              bytes:
                ocrBytes,
              mimeType,
            });

        if (
          ocr.text.length <
            40
        ) {
          throw new Error(
            "Google Vision did not find enough readable property-document text.",
          );
        }

        const proposal =
          parsePropertyOperatingDocumentText(
            ocr.text,
          );
        const evidence =
          await application
            .preserve({
              ownerId:
                user.id,
              propertyId,
              bytes:
                evidenceBytes,
              originalFilename:
                document.name ||
                "property-operating-document.pdf",
              mimeType,
              extractionMethod:
                ocr.extractionMethod,
              parserVersion:
                proposal
                  .parserVersion,
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
      } catch (
        ocrError
      ) {
        const evidence =
          await application
            .preserve({
              ownerId:
                user.id,
              propertyId,
              bytes:
                evidenceBytes,
              originalFilename:
                document.name ||
                "property-operating-document.pdf",
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
                : "Google Vision could not read this property document.",
          },
          {
            status: 422,
          },
        );
      }
    }

    const proposal =
      parsePropertyOperatingDocumentText(
        extraction.text,
      );
    const evidence =
      await application
        .preserve({
          ownerId:
            user.id,
          propertyId,
          bytes:
            evidenceBytes,
          originalFilename:
            document.name ||
            "property-operating-document.pdf",
          mimeType,
          extractionMethod:
            extraction
              .extractionMethod,
          parserVersion:
            proposal
              .parserVersion,
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
          extraction
            .totalPages,
        processedPages:
          extraction
            .totalPages,
        truncated: false,
      },
    });
  } catch (error) {
    console.error(
      "Property operating document proposal error",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to process the property operating document.";

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

function badRequest(
  message,
) {
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
