/**
 * resolver.js — scoped fixture resolution with provenance verification.
 *
 * Resolution order per fixture_ref (deterministic):
 *   1. charge 1 object BEFORE the store entry is touched;
 *   2. grant check (READ_DENIED when the fixture is not granted/registered);
 *   3. source_ref shape validation, then byte-length bounding BEFORE decode;
 *   4. Git blob SHA-1 recompute over the exact resolved bytes
 *      ("blob <len>\\0" + bytes) compared against the pin — HASH_MISMATCH
 *      refuses on any difference;
 *   5. structural pre-split of "rows"; header kind/fixture_id binding
 *      checked against the ref (TARGET_MISMATCH);
 *   6. per row span: charge 1 object BEFORE parsing, then parse and
 *      schema-validate that row alone.
 */

import { gitBlobSha1 } from "./canonical.js";
import { BudgetError, StructuralError, presplitRows } from "./budget.js";
import { validateSourceRef, ROW_VALIDATORS } from "./schemas.js";

/**
 * Resolve every fixture_ref. Returns Map fixture_id -> {kind, bytes,
 * source_ref, rows:[{row, fixture_id, source_ref}]}. Throws RefusalSignal /
 * InputSignal / BudgetError / StructuralError on any failure — always
 * before later candidates are touched.
 */
export function resolveFixtures(task, context, sx) {
  const out = new Map();
  for (const ref of task.fixture_refs) {
    sx.budget.chargeObject(1); // the store entry, before lookup
    if (!Array.isArray(context.grants) || !context.grants.includes(ref.fixture_id)) {
      throw sx.refused("READ_DENIED", `fixture ${JSON.stringify(ref.fixture_id)} is not in the scoped read grants`);
    }
    const entry = context.fixtures?.[ref.fixture_id];
    if (!entry || typeof entry.bytes !== "string" || typeof entry.source_ref !== "object") {
      throw sx.refused("READ_DENIED", `fixture ${JSON.stringify(ref.fixture_id)} is not registered in the fixture store`);
    }
    const vsr = validateSourceRef(entry.source_ref);
    if (!vsr.ok) {
      throw sx.invalid(`fixture ${JSON.stringify(ref.fixture_id)} source_ref invalid: ${vsr.errors.join("; ")}`);
    }
    const bytes = Buffer.from(entry.bytes, "utf8");
    // M640-001: byte length was ALREADY counted by the public-entry
    // pre-scan (the fixture bytes string is opaque until grant admission).
    // Do NOT chargeInputBytes here — that would double-bill.
    // Object charges below are for the newly-parsed candidates (rows,
    // nested spans), which the pre-scan could not see inside the opaque
    // string.
    const recomputed = gitBlobSha1(bytes);
    if (recomputed !== entry.source_ref.blob) {
      throw sx.refused(
        "HASH_MISMATCH",
        `fixture ${JSON.stringify(ref.fixture_id)}: recomputed git blob ${recomputed} != pinned ${entry.source_ref.blob}`
      );
    }
    // M640-007: source membership — the exact (fixture_id, path, blob)
    // tuple must be in the host-registered membership table. Byte
    // integrity (hash match) does NOT establish source identity. Fail
    // closed on a mismatched tuple: no verified citations from an
    // unregistered source.
    const registered = sx.sourceRegistry?.get(ref.fixture_id);
    if (
      !registered ||
      registered.path !== entry.source_ref.path ||
      registered.blob !== entry.source_ref.blob
    ) {
      throw sx.refused(
        "SOURCE_NOT_REGISTERED",
        `fixture ${JSON.stringify(ref.fixture_id)}: source (path, blob) not in host-registered membership table; fail closed, no verified citations`
      );
    }
    let split;
    try {
      split = presplitRows(bytes);
    } catch (e) {
      if (e instanceof StructuralError) {
        if (e.code === "INPUT_TOO_DEEP") throw sx.refused("INPUT_TOO_DEEP", `fixture ${JSON.stringify(ref.fixture_id)}: ${e.message}`);
        throw sx.invalid(`fixture ${JSON.stringify(ref.fixture_id)}: ${e.message}`);
      }
      throw e;
    }
    if (split.header.fixture_id !== ref.fixture_id) {
      throw sx.refused("TARGET_MISMATCH", `fixture header fixture_id ${JSON.stringify(split.header.fixture_id)} != ref ${JSON.stringify(ref.fixture_id)}`);
    }
    if (split.header.kind !== ref.kind) {
      throw sx.refused("TARGET_MISMATCH", `fixture header kind ${JSON.stringify(split.header.kind)} != ref kind ${JSON.stringify(ref.kind)}`);
    }
    if (split.header.schema_version !== "1") {
      throw sx.invalid(`fixture ${JSON.stringify(ref.fixture_id)}: unsupported schema_version ${JSON.stringify(split.header.schema_version)}`);
    }
    const validate = ROW_VALIDATORS[ref.kind];
    const rows = [];
    split.rowSpans.forEach(([s, e], i) => {
      sx.budget.chargeObject(1); // the row candidate, before parsing
      let parsed;
      try {
        parsed = JSON.parse(bytes.toString("utf8", s, e));
      } catch {
        throw sx.invalid(`fixture ${JSON.stringify(ref.fixture_id)} row ${i}: not valid JSON`);
      }
      // Charge every nested evidence_span candidate BEFORE the row
      // validator inspects them. M640-001: nested objects are consulted
      // candidates — they count against BOTH the span budget (byte-range
      // verification) AND the 64-object consultation budget (field
      // inspection). Charging only spans lets nested candidates bypass
      // the object budget.
      const spans = parsed?.evidence_spans;
      if (Array.isArray(spans)) {
        for (const sp of spans) {
          sx.budget.chargeObject(1); // the nested span object, before inspection
          sx.budget.chargeSpan(1);
        }
      }
      const vr = validate(parsed, i);
      if (!vr.ok) {
        throw sx.invalid(`fixture ${JSON.stringify(ref.fixture_id)}: ${vr.errors.join("; ")}`, entry.source_ref, null);
      }
      // Retain the raw byte span for citation construction. The citation
      // quotes the exact UTF-8 bytes of this row.
      rows.push({ row: vr.value, fixture_id: ref.fixture_id, source_ref: entry.source_ref, byte_span: [s, e] });
    });
    sx.fixtureBytes.set(ref.fixture_id, bytes);
    sx.fixtureSourceRefs.set(ref.fixture_id, entry.source_ref);
    out.set(ref.fixture_id, { kind: ref.kind, bytes, source_ref: entry.source_ref, rows });
  }
  return out;
}
