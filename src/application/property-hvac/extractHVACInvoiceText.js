const PDF_MIME_TYPE =
  "application/pdf";

const MAX_INVOICE_BYTES =
  10 * 1024 * 1024;

export async function extractHVACInvoiceText({
  bytes,
  contentType,
}) {
  if (
    contentType !== PDF_MIME_TYPE
  ) {
    throw new Error(
      "HVAC invoice must be a PDF document.",
    );
  }

  if (
    !bytes ||
    bytes.byteLength === 0
  ) {
    throw new Error(
      "HVAC invoice PDF is empty.",
    );
  }

  if (
    bytes.byteLength >
    MAX_INVOICE_BYTES
  ) {
    throw new Error(
      "HVAC invoice PDF must not exceed 10 MB.",
    );
  }

  const {
    extractText,
    getDocumentProxy,
  } = await import("unpdf");

  const document =
    await getDocumentProxy(
      new Uint8Array(bytes),
    );

  const result =
    await extractText(
      document,
      {
        mergePages: true,
      },
    );

  const text =
    String(
      result?.text || "",
    ).trim();

  return Object.freeze({
    text,
    totalPages:
      Number(
        result?.totalPages || 0,
      ),
    extractionMethod:
      text.length >= 40
        ? "native_pdf"
        : "ocr_required",
    requiresOCR:
      text.length < 40,
  });
}
