import { recordGateAttestation } from "@/application/work-management/workPackages";
import { ok, fail, serverError, workAuth, readJson } from "../../_lib/auth.js";

// GET: current attestations for the package (latest per gate first).
// POST { gate, statement, notApplicable?, naReason? }: record a human
// attestation. Interim input for Readiness Review -> Ready until Rung 3.
export async function GET(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const supabase = auth.db;
    const { data, error } = await supabase.from("forge_work_gate_attestations").select("*")
      .eq("owner_id", auth.ownerId).eq("package_id", packageId)
      .order("at", { ascending: false });
    if (error) throw error;
    return ok({ attestations: data || [] });
  } catch (error) {
    return serverError("Gate attestations list error", error);
  }
}

export async function POST(request, { params }) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const { packageId } = await params;
    const body = await readJson(request);
    const result = await recordGateAttestation(auth.db, {
      ownerId: auth.ownerId, actor: auth.actor, packageId,
      gate: body.gate, statement: body.statement,
      notApplicable: body.notApplicable, naReason: body.naReason,
    });
    if (!result.ok) return fail(result);
    return ok({ success: true, attestation: result.attestation }, 201);
  } catch (error) {
    return serverError("Gate attestation error", error);
  }
}
