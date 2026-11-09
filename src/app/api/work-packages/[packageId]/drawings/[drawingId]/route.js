import { workAuth, ok, fail, serverError } from "../../../_lib/auth.js";
import { deleteDrawing } from "@/application/work-management/takeoff";

export async function DELETE(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const result = await deleteDrawing(auth.db, { ownerId: auth.ownerId, packageId, drawingId });
    if (!result.ok) return fail(result);
    // A drawing with review history is retired, not deleted: its
    // rounds, redlines and evidence stay on file (slice 7).
    return ok({ deleted: true, retired: result.retired === true });
  } catch (error) {
    return serverError("DELETE /api/work-packages/[packageId]/drawings/[drawingId]", error);
  }
}
