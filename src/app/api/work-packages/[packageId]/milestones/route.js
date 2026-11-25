import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { getMilestonesSnapshot, instantiateMilestones } from "@/application/work-management/milestones";

// GET /api/work-packages/[packageId]/milestones
// Every active template (with its complexity-tier offsets) plus the
// package's instantiated milestones, with `late` computed on read.
export async function GET(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const result = await getMilestonesSnapshot(auth.db, { ownerId: auth.ownerId, packageId });
    if (!result.ok) return fail(result);
    return ok({
      templates: result.templates,
      instances: result.instances,
      packageStatus: result.packageStatus,
      notApplied: result.notApplied,
    });
  } catch (error) {
    return serverError("GET milestones", error);
  }
}

// POST /api/work-packages/[packageId]/milestones
// Instantiate the package's milestones from a named template + chosen
// complexity tier. Refuses if the package already has milestones.
export async function POST(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const body = await readJson(request);
    const result = await instantiateMilestones(auth.db, { ownerId: auth.ownerId, packageId, input: body });
    if (!result.ok) return fail(result);
    return ok({ instances: result.instances }, 201);
  } catch (error) {
    return serverError("POST milestones", error);
  }
}
