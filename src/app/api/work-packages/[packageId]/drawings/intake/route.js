import { randomUUID } from "node:crypto";
import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { uploadControlledDrawing } from "@/application/work-management/drawingIntake";
import { MAX_PDF_BYTES, MAX_UPLOAD_BYTES } from "@/domains/work-management/drawingReviews.js";

// POST /api/work-packages/[packageId]/drawings/intake
// Multipart upload of one controlled PDF as an immutable IFA revision.
// The server computes the SHA-256 from the actual bytes — the client
// never supplies a hash. The request id makes a double-click or a
// retried submit replay the original receipt instead of creating a
// second revision. Never routes through Designer: an industrial
// isometric is a controlled drawing, not a room/floor plan.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const scopeCheck = await requirePackageScope(auth, packageId);
    if (scopeCheck) return scopeCheck;
    // Fix round 1: enforce the upload size limit at the request
    // boundary. A declared Content-Length above the upload limit is
    // rejected before multipart parsing materializes anything, and a
    // file whose declared size exceeds the PDF limit is rejected
    // before its bytes are buffered. (Next.js App Router exposes no
    // per-route body-parser size option — the Pages-router
    // api.bodyParser limit does not apply here — so the declared-
    // length pre-check plus this pre-buffer file check are the
    // enforceable code boundary; the hosting platform's own request
    // size limit applies on top. A chunked body with no declared
    // length still hits the file.size check before any buffering.)
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
      return fail({ error: "The upload is too large (25 MB maximum).", httpStatus: 413 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail({ error: "A PDF file is required.", httpStatus: 400 });
    }
    if (file.size > MAX_PDF_BYTES) {
      return fail({ error: `The PDF is too large (${file.size} bytes — 25 MB maximum).`, httpStatus: 400 });
    }
    const text = (name) => {
      const value = form.get(name);
      return typeof value === "string" ? value.trim() : "";
    };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadControlledDrawing(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: {
        drawingType: text("drawingType"),
        drawingNumber: text("drawingNumber"),
        lineNumber: text("lineNumber") || null,
        revisionCode: text("revisionCode"),
        issueDate: text("issueDate"),
        issuerRef: text("issuerRef") || null,
        title: text("title") || null,
        pIdDrawingId: text("pIdDrawingId") || null,
        requestId: text("requestId") || randomUUID(),
      },
      file: { bytes, mimeType: file.type || "", originalFilename: file.name || null },
    });
    if (!result.ok) return fail(result);
    return ok({
      artifact: result.artifact,
      drawing: result.drawing,
      revision: result.revision,
      replayed: result.replayed,
    }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/intake", error);
  }
}
