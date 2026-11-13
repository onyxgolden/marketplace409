import { randomUUID } from "node:crypto";
import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { uploadControlledDrawing } from "@/application/work-management/drawingIntake";

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
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail({ error: "A PDF file is required.", httpStatus: 400 });
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
