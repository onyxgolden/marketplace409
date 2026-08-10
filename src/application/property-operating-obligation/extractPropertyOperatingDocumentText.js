const PDF_MIME_TYPE =
  "application/pdf";

const MAX_DOCUMENT_BYTES =
  10 * 1024 * 1024;

export function ensurePropertyDocumentPDFRuntimeCompatibility() {
  if (
    typeof Math.sumPrecise !==
    "function"
  ) {
    Math.sumPrecise =
      function sumPrecise(
        numbers,
      ) {
        return Array.from(
          numbers,
        ).reduce(
          (
            total,
            value,
          ) =>
            total + value,
          0,
        );
      };
  }
}

export async function extractPropertyOperatingDocumentText({
  bytes,
  contentType,
}) {
  if (
    contentType !==
      PDF_MIME_TYPE
  ) {
    throw new Error(
      "Property operating document must be a PDF document.",
    );
  }

  if (
    !bytes ||
    bytes.byteLength === 0
  ) {
    throw new Error(
      "Property operating document PDF is empty.",
    );
  }

  if (
    bytes.byteLength >
      MAX_DOCUMENT_BYTES
  ) {
    throw new Error(
      "Property operating document PDF must not exceed 10 MB.",
    );
  }

  ensurePropertyDocumentPDFRuntimeCompatibility();

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
