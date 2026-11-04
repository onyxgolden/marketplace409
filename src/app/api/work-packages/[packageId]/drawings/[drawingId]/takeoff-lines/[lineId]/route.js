import { workAuth, ok, fail, serverError, readJson } from "../../../../../_lib/auth.js";
import { updateTakeoffLine, deleteTakeoffLine } from "@/application/work-management/takeoff";

export async function PATCH(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId, lineId } = await params;
    const body = await readJson(request);
    const result = await updateTakeoffLine(auth.db, { ownerId: auth.ownerId, packageId, drawingId, lineId, patch: body });
    if (!result.ok) return fail(result);
    return ok({ line: result.line });
  } catch (error) {
    return serverError("PATCH .../takeoff-lines/[lineId]", error);
  }
}

export async function DELETE(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId, lineId } = await params;
    const result = await deleteTakeoffLine(auth.db, { ownerId: auth.ownerId, packageId, drawingId, lineId });
    if (!result.ok) return fail(result);
    return ok({ deleted: true });
  } catch (error) {
    return serverError("DELETE .../takeoff-lines/[lineId]", error);
  }
}
