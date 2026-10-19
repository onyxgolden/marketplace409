/**
 * index.js — public entry for the Sales Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. Deterministic lead classification over
 * preloaded registered synthetic lead bundles: fit precedence
 * (explicit false -> FIT_LOW; missing facts -> FIT_UNKNOWN; both true +
 * timing<=90 -> FIT_HIGH; else FIT_MEDIUM), do_not_contact suppression
 * checked BEFORE draft construction (zero variants when suppressed), two
 * inert outreach drafts per eligible FIT_HIGH lead, and exact
 * BigInt/integer-rational pipeline-health arithmetic. No CRM, no network,
 * no dispatch, no real prospect information. The agent returns a detached
 * advisory JSON snapshot; it cannot approve, merge, deploy, activate,
 * send, or reinterpret authorization.
 *
 * Admission order (S653-006): trap-free Proxy rejection first, then the
 * task, then the context CONTROL plane (clock, grants, principal,
 * criteria, product registry — the sources container is charged but never
 * walked). Principal authority AND validity window are enforced next.
 * Only then, per fixture_ref: read-grant check FIRST, then admission of
 * that one source entry, then blob verification. Denied/unselected source
 * metadata is never touched.
 *
 * Budget discipline: every candidate object — the task, EVERY element of
 * the injected trusted context, each fixture record — is charged with
 * budget.countObject()/chargeObjectOnce() as the FIRST statement before
 * any of its own fields are read, and every reachable string's UTF-8
 * bytes are charged against the single 256-KiB aggregate input budget.
 * Attempt 65 refuses before that candidate (or any later one) is
 * inspected at all; record slots are charged BEFORE JSON.parse decodes
 * them. validateContextControl() requires the caller's live monotonic
 * budget.
 *
 * Population completeness (S653-001): a definitive summary requires
 * TRUSTED, applicable coverage — the host's registered expected_records
 * matching admitted spans for every bundle, the caller's identity claims
 * matching, AND the declared dataset_id/dataset_version binding to every
 * resolved bundle's host-registered identity. A matching caller claim
 * alone never establishes it. Missing/contradictory/unknown coverage
 * suppresses the summary and complete:true; recomputed metrics stay
 * available as partial results.
 */

import { types } from "node:util";
import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import {
  validateTask, validateContextControl, validateSourceEntry, validateLeadRecord,
  splitTopLevelArray, admitGraph, assertDenseArray, assertNotProxy, assertPlainPrototype,
  principalWindowLive, instantStartMs, instantEndMs, SchemaError,
} from "./schemas.js";
import { resolveSourceRef, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanTexts } from "./injection.js";
import { classifyFit, checkSuppression, buildDrafts, computePipelineMetrics, compareHeaderClaims } from "./sales.js";

export const AGENT_ID = "sales-agent";
export const SCHEMA_VERSION = "1";

/**
 * Pre-validation task_id fallback. Preserves the caller's raw task_id
 * when it is a string; otherwise the documented "unavailable" marker.
 * Only safe to call AFTER the trap-free Proxy gate: descriptor reflection
 * on a Proxy would fire user traps (S653-006).
 */
function requestTaskId(task) {
  if (task !== null && typeof task === "object") {
    const desc = Object.getOwnPropertyDescriptor(task, "task_id");
    if (desc && typeof desc.get !== "function" && typeof desc.set !== "function" && typeof desc.value === "string") {
      if (Buffer.byteLength(desc.value, "utf8") > 256) {
        return "[task-id-exceeds-256-bytes]";
      }
      return desc.value;
    }
  }
  return "unavailable";
}

/**
 * Admit the context control plane: trap-free Proxy gate, object charging,
 * and serialized byte charging for every consulted value — but the sources
 * container is charged (keys only) and descriptor-checked WITHOUT
 * recursing into it. Source entries are admitted individually, per granted
 * ref, after the grant check (S653-006).
 *
 * S653-005 (fix round 2): byte accounting uses the single nonduplicating
 * serialized representation (budget.chargeSerialized): each consulted
 * control value is charged once, with structure, quoting and escaping.
 * The sources container's entries are NOT serialized here — only its key
 * list — so selected source bytes are never double-counted.
 */
function admitContextControlGraph(context, budget) {
  assertNotProxy(context, "context");
  budget.chargeObjectOnce(context, "context");
  for (const k of Object.getOwnPropertyNames(context)) {
    const desc = Object.getOwnPropertyDescriptor(context, k);
    if (!desc) continue;
    if (typeof desc.get === "function" || typeof desc.set === "function") {
      throw new SchemaError(`context: accessor property '${k}' is not plain data; refusing`);
    }
    if (typeof desc.value === "function") {
      throw new SchemaError(`context: function property '${k}' is not plain data; refusing`);
    }
    if (typeof desc.value === "symbol") {
      throw new SchemaError(`context: symbol property '${k}' is not plain data; refusing`);
    }
    if (k === "sources") {
      // Charged, proxy-checked, prototype-checked, descriptor-checked —
      // never walked. Only the key list is byte-charged; entries are
      // admitted per granted ref after the grant check.
      assertNotProxy(desc.value, "context.sources");
      assertPlainPrototype(desc.value, "context.sources");
      budget.chargeObjectOnce(desc.value, "context.sources");
      if (desc.value !== null && typeof desc.value === "object") {
        for (const kk of Object.getOwnPropertyNames(desc.value)) {
          const dd = Object.getOwnPropertyDescriptor(desc.value, kk);
          if (dd && (typeof dd.get === "function" || typeof dd.set === "function")) {
            throw new SchemaError(`context.sources: accessor property '${kk}' is not plain data; refusing`);
          }
        }
        budget.chargeSerialized(Object.getOwnPropertyNames(desc.value), "context.sources keys");
      }
      continue;
    }
    admitGraph(desc.value, `context.${String(k)}`, budget);
    budget.chargeSerialized(desc.value, `context.${String(k)}`);
  }
  for (const s of Object.getOwnPropertySymbols(context)) {
    throw new SchemaError(`context: symbol-keyed property '${String(s)}' is not plain data; refusing`);
  }
}

function envelope(taskId, { status, complete, source_refs = [], diagnostics = [], quarantined_sources = [], routing_flags = [], report = null }) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskId,
    status,
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete,
    source_refs,
    diagnostics,
    quarantined_sources,
    routing_flags,
    report: report === undefined ? null : report,
  };
}

function refused(taskId, code, severity, reason, extra = {}) {
  return envelope(taskId, {
    status: "REFUSED",
    complete: false,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    report: null,
    ...extra,
  });
}

/** Byte-bounded refusal: every exit path respects the output byte cap. */
function boundedRefused(taskId, code, severity, reason, extra = {}) {
  const env = refused(taskId, code, severity, reason, extra);
  if (canonicalByteLength(env) <= BUDGET_LIMITS.maxOutputBytes) return env;
  const minimal = refused(
    "[refusal-exceeds-output-cap]",
    code,
    severity,
    String(reason).slice(0, 500)
  );
  if (canonicalByteLength(minimal) > BUDGET_LIMITS.maxOutputBytes) {
    minimal.diagnostics[0].reason = String(reason).slice(0, 100);
  }
  return minimal;
}

/**
 * Verify a raw record span byte-exactly: the slice must decode to the
 * quoted text AND re-encode to the identical bytes (UTF-8 boundary and
 * round-trip check, S653-002). Returns the span record for the citation.
 */
function verifyRecordSpan(bytes, start_byte, end_byte, quoted_text, budget, what) {
  budget.countSpan(what);
  const slice = bytes.subarray(start_byte, end_byte);
  const decoded = slice.toString("utf8");
  const round_trip_ok = decoded === quoted_text && Buffer.from(quoted_text, "utf8").equals(slice);
  if (!round_trip_ok) {
    throw new ResolutionError("SPAN_MISMATCH", `record span at [${start_byte},${end_byte}) does not round-trip byte-exactly`);
  }
  return { start_byte, end_byte, quoted_text, byte_length: end_byte - start_byte, round_trip_ok: true };
}

/**
 * S653-007 (fix round 2): one bounded COMPLETE-envelope record walk with
 * a published taxonomy (see README). Every object occurrence in the final
 * public envelope counts once per emitted occurrence — no shared-identity
 * deduplication, no schema-specific field list. The outer envelope shell
 * itself is the transport container, not a domain record; everything
 * inside it (source_refs, diagnostics, quarantines, classifications,
 * drafts, citations, spans, source-refs, verifications, metrics groups
 * and their nested counts/win-rate/stage-ages, calculation bases,
 * header comparisons, population, summary and its aliases) counts.
 * Arrays are transparent structural nodes (walked into, not counted).
 * Scalars are not records. Bounded depth guards adversarial shapes.
 */
export function countOutputRecords(env) {
  let n = 0;
  const walk = (v, depth) => {
    if (v === null || typeof v !== "object" || depth > 64) return;
    if (Array.isArray(v)) {
      for (const e of v) walk(e, depth + 1);
      return;
    }
    n += 1;
    for (const k of Object.keys(v)) walk(v[k], depth + 1);
  };
  if (env !== null && typeof env === "object") {
    for (const k of Object.keys(env)) walk(env[k], 0);
  }
  return n;
}

/**
 * S653-002 (fix round 3): resolve one evidence source pin against the
 * host-registered sources. Returns {catalog} on success or {error} when
 * the pin cannot be resolved. Selected source bytes are charged exactly
 * once per unique pin (the once-per-selected-source-byte convention) —
 * the caller caches by pin identity so shared pins are not re-charged.
 */
function resolveEvidenceSource(pin, c, admittedEntries, budget) {
  const key = `${pin.repo}|${pin.path}`;
  if (!hasReadGrant(pin, c.readGrants)) {
    return { error: "no read grant for the evidence source" };
  }
  let entry = admittedEntries[key];
  if (!entry) {
    const slotDesc = Object.getOwnPropertyDescriptor(c.sources, key);
    const rawEntry = slotDesc && typeof slotDesc.get !== "function" && typeof slotDesc.set !== "function"
      ? slotDesc.value
      : undefined;
    if (!rawEntry || typeof rawEntry !== "object") {
      return { error: "evidence source not registered" };
    }
    try {
      entry = validateSourceEntry(rawEntry, key, `context.sources[${key}]`, budget);
    } catch (e) {
      // Budget exhaustion is not an unresolvable pin — it means the
      // invocation is over budget. Propagate; the caller refuses.
      if (e instanceof BudgetError) throw e;
      return { error: `evidence source admission failed: ${String(e.message).slice(0, 160)}` };
    }
    admittedEntries[key] = entry;
  }
  let resolved;
  try {
    resolved = resolveSourceRef(pin, { [key]: entry }, budget, `product_registry.evidence`);
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    return { error: `evidence pin failed resolution: ${e.code ?? e.name}: ${String(e.message).slice(0, 160)}` };
  }
  let catalog;
  try {
    catalog = JSON.parse(resolved.text);
  } catch {
    return { error: "evidence source text is not valid JSON" };
  }
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) {
    return { error: "evidence catalog is not a JSON object" };
  }
  return { catalog };
}

/**
 * S653-002 (fix round 3): compute one product's effective evidence.
 * VERIFIED only when the pinned tuple resolves to registered bytes that
 * actually document this product_id; otherwise UNAVAILABLE with a
 * diagnostic (conservative: drafts withheld, never fabricated).
 *
 * The evidence catalog is a host-registered JSON object keyed by
 * product_id. The product binding is an own-data-property check — never
 * inherited, never fuzzy string matching.
 */
function resolveProductEvidence(product, c, admittedEntries, evidenceCache, budget, diagnostics) {
  const ev = product.evidence;
  if (!ev || ev.state !== "VERIFIED") return ev;
  const pin = ev.evidence_ref;
  // Cache by full pin identity: shared pins resolve (and charge bytes)
  // once; per-product binding is still checked individually below.
  const cacheKey = `${pin.repo}|${pin.path}|${pin.commit}|${pin.blob}`;
  let cached = evidenceCache[cacheKey];
  if (!cached) {
    cached = resolveEvidenceSource(pin, c, admittedEntries, budget);
    evidenceCache[cacheKey] = cached;
  }
  const downgrade = (reason) => {
    diagnostics.push({
      code: "PRODUCT_EVIDENCE_UNRESOLVED",
      severity: "warning",
      record_id: null,
      source_ref: null,
      reason: `product '${product.product_id}' evidence pin unresolved (${reason}); treating as UNAVAILABLE, drafts withheld`,
    });
    return { state: "UNAVAILABLE", detail: `evidence pin unresolved: ${reason}`, evidence_ref: undefined };
  };
  if (cached.error) {
    return downgrade(cached.error);
  }
  const itemDesc = Object.getOwnPropertyDescriptor(cached.catalog, product.product_id);
  if (!itemDesc || typeof itemDesc.get === "function" || typeof itemDesc.set === "function" ||
      itemDesc.value === null || typeof itemDesc.value !== "object" || Array.isArray(itemDesc.value)) {
    return downgrade(`evidence catalog does not document product '${product.product_id}'`);
  }
  return ev;
}

/**
 * run(task, context) — the single public entrypoint.
 */
export function run(task, context) {
  const budget = makeBudget();
  // S653-006: trap-free native Proxy rejection BEFORE any reflection,
  // including the task-id fallback. types.isProxy invokes no user trap.
  if (types.isProxy(task) || types.isProxy(context)) {
    return boundedRefused("unavailable", "INVALID_INPUT", "error", "proxy input refused before inspection; proxies are not plain data");
  }
  const taskId = requestTaskId(task);
  try {
    admitGraph(task, "task", budget);
    // S653-005 (fix round 2): the task is byte-charged ONCE under the
    // single nonduplicating serialized representation (structure,
    // quoting, escaping included). admitGraph charges objects only.
    budget.chargeSerialized(task, "task serialized");
    admitContextControlGraph(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  let t, c;
  try {
    t = validateTask(task, budget);
    c = validateContextControl(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // Principal authority: only JASON / MUSE_RELAY through the adapter.
  if (c.principal.role !== "JASON" && c.principal.role !== "MUSE_RELAY") {
    return boundedRefused(taskId, "ACTION_DENIED", "error", "principal role not authorized for this prototype");
  }
  // S653-004: the authorization window must be live at the injected host
  // clock. Expired, future, or inverted windows are denied HERE — before
  // any source entry is admitted, so denied runs never inspect selected
  // payload metadata.
  if (!principalWindowLive(c.principal, c.clock)) {
    return boundedRefused(taskId, "ACTION_DENIED", "error", "principal authorization window is not live at the host clock (expired, future, or inverted); refusing");
  }

  const source_refs = [];
  const diagnostics = [];
  const quarantined_sources = [];

  try {
    // 1. Per fixture_ref: grant check FIRST, then admit + verify that one
    // source entry. Denied/unselected source metadata stays untouched.
    const bundles = [];
    // S653-002 (fix round 3): admitted source entries, reused when a
    // product evidence pin names an already-admitted source.
    const admittedEntries = {};
    for (let i = 0; i < t.fixture_refs.length; i++) {
      const ref = t.fixture_refs[i];
      if (!hasReadGrant(ref, c.readGrants)) {
        return boundedRefused(taskId, "ACTION_DENIED", "error", `no read grant for ${ref.repo}/${ref.path}`);
      }
      const key = `${ref.repo}|${ref.path}`;
      // S653-006 (fix round 2): the selected source slot is read through
      // its OWN data descriptor — never direct property access — so an
      // inherited getter behind the container cannot execute.
      const slotDesc = Object.getOwnPropertyDescriptor(c.sources, key);
      const rawEntry = slotDesc && typeof slotDesc.get !== "function" && typeof slotDesc.set !== "function"
        ? slotDesc.value
        : undefined;
      if (!rawEntry || typeof rawEntry !== "object") {
        return boundedRefused(taskId, "SOURCE_UNVERIFIED", "error", `source not registered: ${key}`);
      }
      let entry;
      try {
        entry = validateSourceEntry(rawEntry, key, `context.sources[${key}]`, budget);
      } catch (e) {
        if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
        if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
        throw e;
      }
      admittedEntries[key] = entry;
      const resolved = resolveSourceRef(ref, { [key]: entry }, budget, `task.fixture_refs[${i}]`);
      source_refs.push({ repo: ref.repo, path: ref.path, commit: ref.commit, blob: ref.blob, algorithm: ref.algorithm, revision: ref.revision });
      bundles.push({
        ref, text: resolved.text, expected_records: resolved.expected_records,
        dataset_id: resolved.dataset_id, dataset_version: resolved.dataset_version,
        coverage: resolved.coverage,
      });
    }

    // 2. Structural split + per-record admission and validation.
    const leads = []; // {record, sourceIndex, quarantined, quarantineFamilies, citation}
    const seenLeadIds = new Set();
    const seenOppIds = new Set();
    for (let bi = 0; bi < bundles.length; bi++) {
      const b = bundles[bi];
      // S653-005 (fix round 2): the bundle text was already charged
      // EXACTLY ONCE in resolveSourceRef. Re-charging it here — or
      // charging per-record slices of the same bytes — would triple-count
      // the selected source bytes. Spans are byte ranges of charged bytes.
      const { spans, bytes } = splitTopLevelArray(b.text, `bundle[${bi}]`);
      b.spanCount = spans.length;
      // Over-long reference lists cannot hide behind the array: bound first.
      if (spans.length > 4096) {
        return boundedRefused(taskId, "INPUT_LIMIT", "error", `bundle[${bi}] declares ${spans.length} records; outer bound is 4096`);
      }
      for (let si = 0; si < spans.length; si++) {
        const { start_byte, end_byte } = spans[si];
        // S653-005: charge the candidate slot BEFORE decoding or inspecting
        // its fields. Candidate 65 refuses here, before JSON.parse runs.
        // (The slot's bytes are part of the once-charged bundle text.)
        budget.countObject(`bundle[${bi}] record ${si} slot`);
        const rawText = bytes.subarray(start_byte, end_byte).toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          return boundedRefused(taskId, "INVALID_INPUT", "error", `bundle[${bi}] record ${si} is not valid JSON`);
        }
        // The slot was pre-charged; skip validateLeadRecord's top-level
        // charge to avoid double-counting the same candidate.
        let record;
        try {
          record = validateLeadRecord(parsed, `bundle[${bi}].records[${si}]`, budget, true);
        } catch (e) {
          if (e instanceof SchemaError) {
            return boundedRefused(taskId, "INVALID_INPUT", "error", `bundle[${bi}] record ${si}: ${e.message}`);
          }
          throw e;
        }
        // Duplicate IDs refuse rather than double-count or first-wins.
        if (seenLeadIds.has(record.lead_id)) {
          return boundedRefused(taskId, "DUPLICATE_ID", "error", `duplicate lead_id '${record.lead_id}'`);
        }
        if (seenOppIds.has(record.opportunity_id)) {
          return boundedRefused(taskId, "DUPLICATE_ID", "error", `duplicate opportunity_id '${record.opportunity_id}'`);
        }
        seenLeadIds.add(record.lead_id);
        seenOppIds.add(record.opportunity_id);
        // S653-002: byte-exact citation for this record's claim inputs.
        // The agreed Citation schema carries quoted_span plus the span
        // triple and the verification record.
        const span = verifyRecordSpan(bytes, start_byte, end_byte, rawText, budget, `citation ${record.lead_id}`);
        const citation = {
          source_ref: { repo: b.ref.repo, path: b.ref.path, commit: b.ref.commit, blob: b.ref.blob, algorithm: "git-sha1", revision: b.ref.revision },
          quoted_span: rawText,
          span,
          verification: { algorithm: "git-sha1", blob: b.ref.blob, byte_length: end_byte - start_byte, round_trip_ok: true },
        };
        // Injection scan over untrusted free-text fields.
        const scan = scanTexts([record.display_name, record.notes]);
        const quarantined = scan.injected;
        if (quarantined) {
          quarantined_sources.push({
            record_id: record.lead_id,
            source_ref: { repo: b.ref.repo, path: b.ref.path, commit: b.ref.commit, blob: b.ref.blob },
            families: scan.families,
            reason: "untrusted field matched a seeded injection family; record quarantined",
          });
        }
        leads.push({ record, sourceIndex: bi, quarantined, quarantineFamilies: scan.families, citation });
      }
      // Host-declared population coverage for this bundle (trusted).
      if (b.expected_records !== undefined && b.expected_records !== spans.length) {
        diagnostics.push({
          code: "POPULATION_MISMATCH", severity: "warning", record_id: null,
          source_ref: { repo: b.ref.repo, path: b.ref.path, commit: b.ref.commit, blob: b.ref.blob },
          reason: `bundle declared ${b.expected_records} records, found ${spans.length}`,
        });
      }
    }

    // S653-002 (fix round 3): resolve product evidence pins against the
    // host-registered sources. VERIFIED evidence is only eligible when its
    // pinned tuple resolves to registered bytes that actually document
    // THIS product. Anything less — no grant, unregistered source,
    // admission failure, blob mismatch, or a catalog that does not name
    // this product — downgrades the evidence to UNAVAILABLE (conservative:
    // drafts withheld, never fabricated). This is eligibility, not a
    // whole-run refusal: classifications and metrics do not depend on
    // product evidence.
    // S653-002 (fix round 3): product evidence resolves LAZILY, only
    // when a draft might actually be built. Evidence sources resolve once
    // per unique pin; the byte charge follows the
    // once-per-selected-source-byte convention even when several products
    // share a catalog. Runs that build no drafts (suppressed,
    // quarantined, non-FIT_HIGH) never pay the resolution cost.
    const evidenceCache = {};
    const effectiveEvidenceCache = {};
    const getEffectiveEvidence = (pid) => {
      if (!(pid in effectiveEvidenceCache)) {
        const product = c.product_registry[pid];
        effectiveEvidenceCache[pid] = product
          ? resolveProductEvidence(product, c, admittedEntries, evidenceCache, budget, diagnostics)
          : undefined;
      }
      return effectiveEvidenceCache[pid];
    };

    // S653-001: trusted, applicable population completeness. Requires ALL
    // of: the caller declared complete; the host's registered
    // expected_records matches admitted spans on EVERY bundle; the
    // caller's identity claims match; the declared dataset_id /
    // dataset_version binds to every resolved bundle's host-registered
    // identity; AND the host's declared coverage contract covers the
    // task's report interval on EVERY bundle (fix round 2). A matching
    // caller claim alone never establishes it — and a caller-selected
    // period cannot supply its own coverage.
    let populationComplete = false;
    if (t.population && t.population.declared_complete) {
      const actualIds = new Set(leads.map((l) => l.record.lead_id));
      let claimOk = true;
      const expectedIds = t.population.expected_lead_ids;
      const expectedCount = t.population.expected_count;
      if (expectedIds !== undefined) {
        if (expectedIds.length !== actualIds.size) claimOk = false;
        else for (const id of expectedIds) if (!actualIds.has(id)) { claimOk = false; break; }
      }
      if (expectedCount !== undefined && expectedCount !== leads.length) claimOk = false;
      const hostCovered = bundles.length > 0 && bundles.every(
        (b) => b.expected_records !== undefined && b.expected_records === b.spanCount
      );
      const identityBound = bundles.length > 0 && bundles.every(
        (b) => b.dataset_id === t.population.dataset_id && b.dataset_version === t.population.dataset_version
      );
      const intervalCovered = bundles.length > 0 && bundles.every((b) => {
        const cov = b.coverage;
        if (!cov) return false;
        return instantStartMs(cov.interval_start) <= instantStartMs(t.options.report_interval_start) &&
          instantEndMs(cov.interval_end) >= instantEndMs(t.options.report_interval_end);
      });
      populationComplete = claimOk && hostCovered && identityBound && intervalCovered;
      if (!populationComplete) {
        diagnostics.push({
          code: "POPULATION_INCOMPLETE", severity: "warning", record_id: null, source_ref: null,
          reason: "declared-complete population not established against host-registered coverage, dataset identity, and report-period applicability; whole-pipeline totals unverified",
        });
      }
    }

    // 3. Classify, suppress, draft.
    const classified = [];
    const draftRecords = [];
    // S653-002 (fix round 3): the applicable criterion, pinned by its
    // host-registered id+version — a versioned reference, not prose. The
    // criteria are host-registered out-of-band; the id+version tuple is
    // their identity.
    const criteriaEvidence = {
      criteria_id: c.criteria.criteria_id,
      criteria_version: c.criteria.criteria_version,
      state: "HOST_REGISTERED",
    };
    for (const l of leads) {
      const { fit, gaps } = classifyFit(l.record, c.criteria.fit_high_timing_days);
      const { suppressed } = checkSuppression(l.record);
      let drafts = [];
      let draftReason = null;
      if (suppressed) {
        draftReason = "SUPPRESSED: do_not_contact=true checked before draft construction; zero variants";
      } else if (l.quarantined) {
        draftReason = "QUARANTINED: untrusted field matched an injection family; no draft";
      } else if (fit === "FIT_HIGH" && t.options.include_drafts) {
        const product = c.product_registry[l.record.fixture_product_id];
        // S653-002 (fix round 3): the EFFECTIVE evidence — VERIFIED only
        // when the evidence pin resolved to registered bytes documenting
        // this product. Anything less withholds drafts. Resolved lazily:
        // suppressed/quarantined/non-FIT_HIGH leads never trigger it.
        const effEvidence = product ? getEffectiveEvidence(l.record.fixture_product_id) : undefined;
        if (!product) {
          draftReason = "NO_PRODUCT: fixture_product_id not in the host product registry";
        } else if (!product.verified) {
          draftReason = "UNVERIFIED_PRODUCT: product entry not verified; no draft";
        } else if (!effEvidence || effEvidence.state !== "VERIFIED") {
          draftReason = `UNAVAILABLE_PRODUCT_EVIDENCE: ${effEvidence ? effEvidence.detail : "no effective evidence"}; no draft`;
        } else {
          drafts = buildDrafts(l.record, product, c.criteria);
        }
      } else if (fit !== "FIT_HIGH") {
        draftReason = `NO_DRAFT: fit is ${fit}, not FIT_HIGH`;
      } else {
        draftReason = "NO_DRAFT: include_drafts=false";
      }
      classified.push({
        lead_id: l.record.lead_id,
        opportunity_id: l.record.opportunity_id,
        fit,
        gaps,
        suppressed,
        quarantined: l.quarantined,
        quarantine_families: l.quarantineFamilies,
        stage: l.record.stage,
        currency: l.record.currency,
        criteria_version: c.criteria.criteria_version,
        criteria_evidence: criteriaEvidence,
        citation: l.citation,
      });
      for (const d of drafts) {
        const product = c.product_registry[l.record.fixture_product_id];
        const effEvidence = getEffectiveEvidence(l.record.fixture_product_id);
        draftRecords.push({
          lead_id: l.record.lead_id,
          variant: d.variant,
          text: d.text,
          marker: d.marker,
          // S653-002 (fix round 3): the emitted product evidence carries
          // the resolved evidence pin — the versioned source tuple — so
          // the VERIFIED assertion is traceable to registered bytes.
          // Drafts are only built when the effective evidence is
          // VERIFIED (see above).
          citation: {
            ...l.citation,
            product_evidence: {
              state: effEvidence.state,
              detail: effEvidence.detail,
              product_id: product.product_id,
              product_token: product.product_token,
              evidence_ref: effEvidence.evidence_ref ?? null,
            },
          },
        });
      }
      if (draftReason) {
        diagnostics.push({
          code: suppressed ? "SUPPRESSED" : l.quarantined ? "QUARANTINED" : "NO_DRAFT",
          severity: "info",
          record_id: l.record.lead_id,
          source_ref: null,
          reason: draftReason,
        });
      }
    }

    // 4. Pipeline metrics (exact rational arithmetic).
    const metrics = computePipelineMetrics(
      classified.map((cl, i) => ({ record: leads[i].record, fit: cl.fit, gaps: cl.gaps, suppressed: cl.suppressed })),
      t.options
    );
    // S653-002 (fix round 2): calculation-basis records for every metric
    // group — the contributing verified lead citations plus the applicable
    // criterion/version. Contributing leads are linked by lead_id to the
    // classification records in this same report (which carry the
    // byte-exact citations) rather than duplicating citation bytes; every
    // metric input is traceable to evidence without double-emitting it.
    for (const m of metrics) {
      m.calculation_basis = {
        criteria_ref: { criteria_id: c.criteria.criteria_id, criteria_version: c.criteria.criteria_version },
        criteria_evidence: criteriaEvidence,
        rule: "open stages NEW/QUALIFICATION/PROPOSAL; open_gross=sum(amount_minor) exact; open_weighted=sum(amount_minor*probability_num/probability_den) rounded once half-away-from-zero; win_rate=CLOSED_WON/(CLOSED_WON+CLOSED_LOST) over closed_at within the report interval; stage_age=(as_of-stage_entered_at) elapsed UTC minutes",
        contributing_leads: classified
          .filter((cl) => cl.currency === m.currency)
          .map((cl) => ({ lead_id: cl.lead_id })),
        link_note: "each contributing_leads[].lead_id resolves to report.classifications[] in this envelope, which carries the byte-exact citation for that lead's claim inputs",
      };
    }

    // 5. Header-claim comparison; mismatch OR inapplicable interval
    // suppresses the definitive summary (comparison evidence retained).
    const headerCheck = compareHeaderClaims(t.header_claims, metrics, t.options);
    let headerOk = true;
    if (headerCheck.checked) {
      headerOk = headerCheck.match;
      if (!headerCheck.match) {
        diagnostics.push({
          code: "HEADER_MISMATCH", severity: "error", record_id: null, source_ref: null,
          reason: headerCheck.interval_match
            ? `header claims open_gross_minor=${headerCheck.claimed} ${headerCheck.currency} but recomputation gives ${headerCheck.computed}; definitive summary suppressed`
            : `header interval does not match the task report interval; claim not applicable to this recomputation; definitive summary suppressed`,
        });
      }
    }
    const metricsVerifiable = metrics.every((m) => !m.unverifiable);
    // S653-001: the definitive summary requires trusted, applicable
    // population completeness. Without it the recomputed metrics below
    // remain available as clearly partial results.
    let summary = null;
    if (headerOk && metricsVerifiable && populationComplete) {
      summary = { metrics, header_comparison: headerCheck.checked ? headerCheck : null };
    }

    const complete = summary !== null && quarantined_sources.length === 0;
    const status = complete ? "REPORT_READY" : "PARTIAL";

    const report = {
      classifications: classified,
      drafts: draftRecords,
      metrics,
      header_comparison: headerCheck.checked ? headerCheck : null,
      summary,
      population: t.population ? {
        declared_complete: t.population.declared_complete,
        dataset_id: t.population.dataset_id,
        dataset_version: t.population.dataset_version,
        complete: populationComplete,
      } : null,
    };

    const result = envelope(taskId, {
      status,
      complete,
      source_refs,
      diagnostics,
      quarantined_sources,
      routing_flags: [],
      report,
    });

    // S653-007: one bounded final-envelope accounting walk. Overrun returns
    // bounded REFUSED, complete:false, report:null — no partial artifact.
    const prefill = c.test_hooks && typeof c.test_hooks.prefill_output_records === "number"
      ? c.test_hooks.prefill_output_records : 0;
    const outCount = prefill + countOutputRecords(result);
    if (outCount > BUDGET_LIMITS.maxOutputRecords) {
      return boundedRefused(taskId, "OUTPUT_LIMIT", "error", `public output records ${outCount} exceed ${BUDGET_LIMITS.maxOutputRecords}`);
    }
    // Final-envelope output byte accounting: the exact returned bytes.
    const outBytes = canonicalByteLength(result);
    if (outBytes > BUDGET_LIMITS.maxOutputBytes) {
      return boundedRefused(taskId, "OUTPUT_LIMIT", "error", `final envelope is ${outBytes} bytes, cap is ${BUDGET_LIMITS.maxOutputBytes}`);
    }
    return result;
  } catch (e) {
    if (e instanceof BudgetError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof ResolutionError) return boundedRefused(taskId, e.code, "error", e.message);
    if (e instanceof SchemaError) return boundedRefused(taskId, "INVALID_INPUT", "error", e.message);
    throw e;
  }
}
