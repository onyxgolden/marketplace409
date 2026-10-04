import { createGateOverride } from "@/application/work-management/workGates";
import { ok, fail, serverError, workAuth, readJson } from "../../../_lib/auth.js";

// POST { gate, reason, expiresAt }: record a human override. The actor is
// stamped from the caller's JWT by the DB trigger — never from the body.
export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    const override = await createGateOverride(auth.db, {
      ownerId: auth.ownerId, packageId,
      gate: body.gate, reason: body.reason, expiresAt: body.expiresAt,
      nowIso: new Date().toISOString(),
    });
    return ok({ success: true, override }, 201);
  } catch (error) {
    // Domain validation failures (bad gate, missing reason, bad expiry)
    // surface as 400s; unexpected failures as 500s.
    const msg = error && error.message ? error.message : "";
    if (/unknown gate|requires a reason|expiry/i.test(msg)) {
      return fail({ error: msg, httpStatus: 400 });
    }
    return serverError("Gate override error", error);
  }
}
