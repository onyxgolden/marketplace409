// collectEvidence (Slice 2) — run a capability's adapters, fail-closed.
//
// `collectEvidence(capabilityId, { now, deps })` looks up the capability's
// adapter spec and runs each adapter. The result is always:
//   { capability_id, ok: true, results: [{ adapter, ok: true, evidence }] }
// or, when anything is wrong:
//   { capability_id, ok: false, error, results: [...] }
// with per-adapter results preserved so a caller can see which source
// failed. One failed adapter fails the collection: partial evidence is
// never presented as a clean bill.
//
// This module performs no evaluation ("is the capability healthy?") —
// that is Slice 3. It only gathers the evidence Slice 3 will evaluate.

import { ADAPTER_TYPES } from "./adapterTypes.mjs";
import { getAdapterSpec, validateAdapterSpecs } from "./evidenceAdapters.mjs";
import { getCapability } from "../runtimeCoverageRegistry.mjs";

export async function collectEvidence(capabilityId, { now, deps } = {}) {
  if (typeof capabilityId !== "string" || capabilityId.length === 0) {
    return { capability_id: capabilityId, ok: false, error: "capabilityId must be a non-empty string", results: [] };
  }
  if (!getCapability(capabilityId)) {
    return { capability_id: capabilityId, ok: false, error: `unknown capability "${capabilityId}"`, results: [] };
  }
  const specCheck = validateAdapterSpecs();
  if (!specCheck.ok) {
    return {
      capability_id: capabilityId,
      ok: false,
      error: `adapter specs invalid: ${specCheck.errors.join("; ")}`,
      results: [],
    };
  }
  const spec = getAdapterSpec(capabilityId);
  if (!spec) {
    return {
      capability_id: capabilityId,
      ok: false,
      error: `no evidence adapters specified for "${capabilityId}" (see UNSPECIFIED_CAPABILITIES)`,
      results: [],
    };
  }
  const at = Number.isFinite(now) ? now : Date.now();
  const results = [];
  for (const a of spec.adapters) {
    const impl = ADAPTER_TYPES[a.type];
    if (!impl) {
      results.push({ adapter: a.type, ok: false, error: `unknown adapter type "${a.type}"` });
      continue;
    }
    try {
      const r = await impl(a, deps || {}, at);
      results.push({
        adapter: a.type,
        ok: r.ok === true,
        ...(r.ok === true ? { evidence: r.evidence } : { error: r.error || "adapter returned no error" }),
      });
    } catch (e) {
      results.push({
        adapter: a.type,
        ok: false,
        error: `adapter threw: ${e && e.message ? e.message : String(e)}`,
      });
    }
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    return {
      capability_id: capabilityId,
      ok: false,
      error: `${failed.length} of ${results.length} adapter(s) failed`,
      results,
    };
  }
  return { capability_id: capabilityId, ok: true, results };
}
