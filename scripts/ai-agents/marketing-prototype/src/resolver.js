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
 * getDataDescriptor(obj, key) — OWN-data-descriptor-only stable admission.
 *
 * Returns the OWN data descriptor for `key`, or null when `key` is an own
 * accessor property (rejected without invocation — Object.getOwnPropertyDescriptor
 * never calls user code), or undefined when the property is absent as an own
 * property (missing OR inherited-only).
 *
 * M640-001 (round 5): the earlier version walked the prototype chain and
 * accepted inherited data properties. The input-byte pre-scan
 * (measureCanonicalBytes) only measures OWN properties, so an inherited data
 * property admitted an unmeasured, unlimited payload past the input cap
 * (307486-byte inherited `bytes` => REPORT_READY). Admission now describes
 * exactly the same data accounting measured: own data only.
 * Missing/inherited-only fields refuse structurally (not registered) —
 * the resolver never walks a prototype to recover values the pre-scan
 * never charged.
 */
function getDataDescriptor(obj, key) {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (!d) return undefined;
  return "value" in d ? d : null;
}

/** Source identity fields compared against the host-registered tuple. */
const SOURCE_IDENTITY_FIELDS = ["repo", "path", "commit", "blob", "algorithm", "revision"];

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
    // M640-001 (round 4): stable admission. The store entry, the bytes
    // payload, and every source-identity field are admitted ONLY through
    // data descriptors — checked BEFORE any read, WITHOUT invoking a
    // getter. An accessor-backed field refuses ACCESSOR_REJECTED here.
    // The grant check above runs first, so a DENIED fixture's accessors
    // stay unread (zero invocations).
    const entryDesc = getDataDescriptor(context.fixtures, ref.fixture_id);
    if (entryDesc === null) {
      throw sx.refused("ACCESSOR_REJECTED", `fixture ${JSON.stringify(ref.fixture_id)}: store entry is accessor-backed (rejected without invocation)`);
    }
    const entry = entryDesc?.value;
    if (entry === null || typeof entry !== "object") {
      throw sx.refused("READ_DENIED", `fixture ${JSON.stringify(ref.fixture_id)} is not registered in the fixture store`);
    }
    const bytesDesc = getDataDescriptor(entry, "bytes");
    if (bytesDesc === null) {
      throw sx.refused("ACCESSOR_REJECTED", `fixture ${JSON.stringify(ref.fixture_id)}: bytes is accessor-backed (rejected without invocation)`);
    }
    const bytesValue = bytesDesc?.value;
    if (typeof bytesValue !== "string") {
      throw sx.refused("READ_DENIED", `fixture ${JSON.stringify(ref.fixture_id)} is not registered in the fixture store`);
    }
    const srDesc = getDataDescriptor(entry, "source_ref");
    if (srDesc === null) {
      throw sx.refused("ACCESSOR_REJECTED", `fixture ${JSON.stringify(ref.fixture_id)}: source_ref is accessor-backed (rejected without invocation)`);
    }
    const sourceRef = srDesc?.value;
    if (typeof sourceRef !== "object") {
      throw sx.refused("READ_DENIED", `fixture ${JSON.stringify(ref.fixture_id)} is not registered in the fixture store`);
    }
    // M640-001 (round 4): the same stable-admission rule for source
    // identity metadata, not just the body string. Every compared field
    // must be an OWN data descriptor before validateSourceRef reads it.
    // M640-001 (round 5): validateSourceRef reads via normal property
    // access (which walks prototypes), so an inherited-only identity
    // field must ALSO refuse here — the pre-scan never measured it.
    for (const f of SOURCE_IDENTITY_FIELDS) {
      const fd = getDataDescriptor(sourceRef, f);
      if (fd === null) {
        throw sx.refused("ACCESSOR_REJECTED", `fixture ${JSON.stringify(ref.fixture_id)}: source_ref.${f} is accessor-backed (rejected without invocation)`);
      }
      if (fd === undefined) {
        throw sx.refused("READ_DENIED", `fixture ${JSON.stringify(ref.fixture_id)}: source_ref.${f} is missing or inherited-only (not registered as own data)`);
      }
    }
    const vsr = validateSourceRef(sourceRef);
    if (!vsr.ok) {
      throw sx.invalid(`fixture ${JSON.stringify(ref.fixture_id)} source_ref invalid: ${vsr.errors.join("; ")}`);
    }
    // Single stable read of the admitted payload: the value came from a
    // data descriptor, so it is the same immutable string the public-entry
    // pre-scan measured and charged. No getter can fire here and the
    // payload cannot change between measurement and admission.
    const bytes = Buffer.from(bytesValue, "utf8");
    // M640-001: byte length was ALREADY counted by the public-entry
    // pre-scan (the fixture bytes string is opaque until grant admission).
    // Do NOT chargeInputBytes here — that would double-bill.
    // Object charges below are for the newly-parsed candidates (rows,
    // nested spans), which the pre-scan could not see inside the opaque
    // string.
    const recomputed = gitBlobSha1(bytes);
    if (recomputed !== sourceRef.blob) {
      throw sx.refused(
        "HASH_MISMATCH",
        `fixture ${JSON.stringify(ref.fixture_id)}: recomputed git blob ${recomputed} != pinned ${sourceRef.blob}`
      );
    }
    // M640-007: source membership — the COMPLETE registered source
    // identity (repo, path, commit, blob, algorithm, revision) must match
    // the host-registered tuple for this fixture_id. Byte integrity (hash
    // match) and a correct path do NOT establish the repository tree or
    // commit in which those bytes were registered. Fail closed on ANY
    // field mismatch: no verified citations from an unregistered source.
    // The registry is host-injected separately — never rebuilt by
    // candidate code from the entry being authenticated.
    const registered = sx.sourceRegistry?.get(ref.fixture_id);
    const sr = sourceRef;
    if (
      !registered ||
      registered.repo !== sr.repo ||
      registered.path !== sr.path ||
      registered.commit !== sr.commit ||
      registered.blob !== sr.blob ||
      registered.algorithm !== sr.algorithm ||
      registered.revision !== sr.revision
    ) {
      throw sx.refused(
        "SOURCE_NOT_REGISTERED",
        `fixture ${JSON.stringify(ref.fixture_id)}: source identity (repo,path,commit,blob,algorithm,revision) not in host-registered membership table; fail closed, no verified citations`
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
        throw sx.invalid(`fixture ${JSON.stringify(ref.fixture_id)}: ${vr.errors.join("; ")}`, sourceRef, null);
      }
      // Retain the raw byte span for citation construction. The citation
      // quotes the exact UTF-8 bytes of this row.
      rows.push({ row: vr.value, fixture_id: ref.fixture_id, source_ref: sourceRef, byte_span: [s, e] });
    });
    sx.fixtureBytes.set(ref.fixture_id, bytes);
    sx.fixtureSourceRefs.set(ref.fixture_id, sourceRef);
    out.set(ref.fixture_id, { kind: ref.kind, bytes, source_ref: sourceRef, rows });
  }
  return out;
}
