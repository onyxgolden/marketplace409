import { workAuth, ok, fail, serverError, readJson } from "../../../_lib/auth.js";
import { updateDrawing, deleteDrawing } from "@/application/work-management/takeoff";

export async function PATCH(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { drawingId } = await params;
    const body = await readJson(request);
    const result = await updateDrawing(auth.db, { ownerId: auth.ownerId, drawingId, patch: body });
    if (!result.ok) return fail(result);
    return ok({ drawing: result.drawing });
  } catch (error) {
    return serverError("PATCH /api/work-packages/[packageId]/drawings/[drawingId]", error);
  }
}

export async function DELETE(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { drawingId } = await params;
    const result = await deleteDrawing(auth.db, { ownerId: auth.ownerId, drawingId });
    if (!result.ok) return fail(result);
    return ok({ deleted: true });
  } catch (error) {
    return serverError("DELETE /api/work-packages/[packageId]/drawings/[drawingId]", error);
  }
}
