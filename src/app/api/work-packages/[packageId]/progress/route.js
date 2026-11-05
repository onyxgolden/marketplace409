import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { listProgressEntries, createProgressEntry } from "@/application/work-management/progress";

export async function GET(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const search = new URL(request.url).searchParams;
    const includeVoidedParam = search.get("includeVoided");
    const result = await listProgressEntries(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      lineId: search.get("lineId") || undefined,
      from: search.get("from") || undefined,
      to: search.get("to") || undefined,
      includeVoided: includeVoidedParam === "false" ? false : undefined,
      limit: search.get("limit") || undefined,
      offset: search.get("offset") || undefined,
    });
    if (!result.ok) return fail(result);
    return ok({ entries: result.entries, from: result.from, to: result.to });
  } catch (error) {
    return serverError("GET /api/work-packages/[packageId]/progress", error);
  }
}

export async function POST(request, { params }) {
  const auth = await workAuth();
  if (auth.error) return auth.error;
  try {
    const { packageId } = await params;
    const body = await readJson(request);
    const result = await createProgressEntry(auth.db, {
      ownerId: auth.ownerId,
      actor: auth.actor,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ entry: result.entry }, 201);
  } catch (error) {
    return serverError("POST /api/work-packages/[packageId]/progress", error);
  }
}
