import { listPackagePropertyOptions } from "@/application/work-management/workPackages";
import { ok, serverError, workAuth } from "../_lib/auth.js";

// Property options for the work-package property picker: one entry per
// canonical residential property in the caller's workspace (aliases
// deduped). Read-only and owner-scoped via workAuth — the effective owner
// is resolved server-side, never taken from the client.
export async function GET() {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const result = await listPackagePropertyOptions(auth.db, { ownerId: auth.ownerId });
    return ok(result);
  } catch (error) {
    return serverError("Work package property options error", error);
  }
}
