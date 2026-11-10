import { workAuth, ok, fail, serverError, readJson } from "../../_lib/auth.js";
import { setCraftRate } from "@/application/work-management/changeOrders";

// PUT /api/work-packages/[packageId]/craft-rates
// Set a craft's labor rate for one package (upsert — a craft with no
// stored rate uses the $89/hr default until one is set here).
// Version-guarded with a required reason.
export async function PUT(request, { params }) {
  const auth = await workAuth(request);
  if (auth.error) return auth.error;
  const { packageId } = await params;
  try {
    const body = await readJson(request);
    const result = await setCraftRate(auth.db, {
      ownerId: auth.ownerId,
      packageId,
      input: body,
    });
    if (!result.ok) return fail(result);
    return ok({ craftRate: result.craftRate, packageStatus: result.packageStatus });
  } catch (error) {
    return serverError("PUT craft-rates", error);
  }
}
