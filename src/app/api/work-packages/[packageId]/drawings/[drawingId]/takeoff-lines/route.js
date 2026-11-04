import { workAuth, ok, fail, serverError, readJson } from "../../../../_lib/auth.js";
import { createTakeoffLine, listTakeoffLinesForDrawing } from "@/application/work-management/takeoff";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const result = await listTakeoffLinesForDrawing(auth.db, { ownerId: auth.ownerId, packageId, drawingId });
    if (!result.ok) return fail(result);
    return ok({ lines: result.lines });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings/[drawingId]/takeoff-lines", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId, drawingId } = await params;
    const body = await readJson(request);
    const result = await createTakeoffLine(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      actor: auth.actor,
      input: { ...body, drawingId },
    });
    if (!result.ok) return fail(result);
    return ok({ line: result.line }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings/[drawingId]/takeoff-lines", error);
  }
}
