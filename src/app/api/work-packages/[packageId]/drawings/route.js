import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { createDrawing, listDrawingsForPackage } from "@/application/work-management/takeoff";

export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const result = await listDrawingsForPackage(auth.db, { ownerId: auth.ownerId, packageId });
    if (!result.ok) return fail(result);
    return ok({ drawings: result.drawings });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/drawings", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const body = await readJson(request);
    const result = await createDrawing(auth.db, {
      ownerId: auth.ownerId,
      actor: auth.actor,
      input: { ...body, packageId },
    });
    if (!result.ok) return fail(result);
    return ok({ drawing: result.drawing }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/drawings", error);
  }
}
