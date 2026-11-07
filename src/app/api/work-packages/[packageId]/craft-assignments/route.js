import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { listCraftAssignments, createCraftAssignment } from "@/application/work-management/craftAssignments";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const search = new URL(request.url).searchParams;
    const includeRetiredParam = search.get("includeRetired");
    const result = await listCraftAssignments(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      from: search.get("from") || undefined,
      to: search.get("to") || undefined,
      craft: search.get("craft") || undefined,
      shift: search.get("shift") || undefined,
      includeRetired: includeRetiredParam === "true",
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({
      assignments: result.assignments,
      dayTotals: result.dayTotals,
      from: result.from,
      to: result.to,
      packageStatus: result.packageStatus,
    });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/craft-assignments", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const body = await readJson(request);
    const result = await createCraftAssignment(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ assignment: result.assignment }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/craft-assignments", error);
  }
}
