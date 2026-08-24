const PDF_MIME_TYPE = "application/pdf";
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MIN_NATIVE_TEXT_LENGTH = 40;

// unpdf's WASM PDF.js build needs Math.sumPrecise on some Node runtimes that don't yet implement
// it natively (same guard extractHVACInvoiceText.js applies for the same dependency).
function ensurePDFRuntimeCompatibility() {
  if (typeof Math.sumPrecise !== "function") {
    Math.sumPrecise = function sumPrecise(numbers) {
      return Array.from(numbers).reduce((total, value) => total + value, 0);
    };
  }
}

// Generic native-PDF text extraction, tried before falling back to Google Cloud Vision OCR (see
// GoogleCloudVisionOCRAdapter) -- most PDFs (surveys, deeds, title policies, tax documents) already
// carry a real text layer, so this avoids an OCR round-trip for the common case. Deliberately not
// document-type-specific, unlike extractHVACInvoiceText.js, so any consumer can reuse it.
export async function extractNativePdfText({ bytes, contentType }) {
  if (contentType !== PDF_MIME_TYPE) {
    throw new Error("Native PDF text extraction requires a PDF document.");
  }
  if (!bytes || bytes.byteLength === 0) {
    throw new Error("PDF is empty.");
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error("PDF must not exceed 10 MB.");
  }

  ensurePDFRuntimeCompatibility();

  const { extractText, getDocumentProxy } = await import("unpdf");
  const document = await getDocumentProxy(new Uint8Array(bytes));
  const result = await extractText(document, { mergePages: true });
  const text = String(result?.text || "").trim();

  return Object.freeze({
    text,
    totalPages: Number(result?.totalPages || 0),
    extractionMethod: text.length >= MIN_NATIVE_TEXT_LENGTH ? "native_pdf" : "ocr_required",
    requiresOCR: text.length < MIN_NATIVE_TEXT_LENGTH,
  });
}
