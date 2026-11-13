import { randomUUID } from "node:crypto";
import { requirePackageScope, workAuth, ok, fail, serverError } from "../../../../_lib/auth.js";
import { stageIfcArtifact } from "@/application/work-management/drawingIntake";

// POST /api/work-packages/[packageId]/drawings/[drawingId]/ifc-stage
// Multipart upload staging a drafter-issued PDF as an IFC candidate.
// No revision is created: the bytes stay pending until the IFC release
// attaches them. The staged bytes must differ from the latest issued
// revision (enforced by the RPC).
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
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
    const result = await stageIfcArtifact(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      drawingId,
      input: { requestId: text("requestId") || randomUUID() },
      file: { bytes, mimeType: file.type || "", originalFilename: file.name || null },
    });
    if (!result.ok) return fail(result);
    return ok({ artifact: result.artifact, replayed: result.replayed }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/[drawingId]/ifc-stage", error);
  }
}
