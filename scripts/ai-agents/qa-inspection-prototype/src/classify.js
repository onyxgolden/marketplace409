/**
 * classify.js — the QA/Inspection prototype core: run(task, context) -> result.
 *
 * A fixture inspection-report generator. It verifies synthetic evidence
 * about controls and never performs inspection actions: there is no browser
 * adapter, no control-execution path, no tool-call path, and no file-write
 * API. Exercise requests for payment/send/production_write/persistent-save
 * are refused with ACTION_DENIED; exercise of any other kind is refused with
 * EXERCISE_UNSUPPORTED (denial only, no domain output).
 *
 * Classification rules (from the brief):
 * - no usable evidence -> UNVERIFIED
 * - required read denied/unreachable or wrong-build evidence -> BLOCKED
 * - verified observed failure -> FAIL
 * - opposing outcomes across modalities/evidence -> keep both, flag
 *   contradiction, FAIL when a verified failure exists, never overall PASS
 * - overall control PASS only when every required assertion AND every
 *   required modality is verified and matching, with no contradiction and
 *   no blocking evidence
 * - screenshot presence alone never proves Save/export behavior; PASS needs
 *   a structured observed-vs-expected assertion with registered evidence
 */

import { createHash } from "node:crypto";
import {
  validateTask,
  validateEvidenceRecord,
  isValidDateString,
  MODALITIES,
} from "./schemas.js";
import { scanRecord, scanTaskLabels, scanInjection } from "./injection.js";

export const AGENT_ID = "qa-inspection-prototype";
export const SCHEMA_VERSION = "1";

/** Kinds whose exercise is prohibited outright (persistent effects). */
const PROHIBITED_EXERCISE_KINDS = new Set(["payment", "send", "production_write", "save"]);

// Budget limits (common contract, slice 1). These caps bind the resolved
// input/read path, not just the task JSON. They may only change through an
// explicit scoped contract revision — never an undocumented shortcut.
const MAX_TASK_BYTES = 256 * 1024; // total task data
const MAX_OUTPUT_BYTES = 256 * 1024; // total output data
const MAX_OBJECT_RESOLUTIONS = 64; // every resolver access counts, ledger reads included
const MAX_SPAN_CHECKS = 512; // every evidence record examined
const MAX_OUTPUT_RECORDS = 256; // control results + assertion results emitted
const MAX_RESOLVED_BYTES = 256 * 1024; // resolved fixture payload bytes

/** Thrown when a budget is exhausted; run() converts it to a structured denial. */
class BudgetExceeded extends Error {
  constructor(dimension, limit, observed) {
    super(`${dimension} budget exceeded: ${observed} > ${limit}`);
    this.name = "BudgetExceeded";
    this.dimension = dimension;
    this.limit = limit;
    this.observed = observed;
  }
}

/**
 * Counts and bounds every resolver access. Every method call is one object
 * resolution; every evidence record returned is one span check; every
 * returned payload's bytes accumulate against the resolved-input byte cap —
 * including grant and observer responses (QAI-005). Exhaustion throws
 * BudgetExceeded — never a partial success.
 */
class BudgetedResolver {
  constructor(resolver, budget) {
    this.inner = resolver;
    this.budget = budget;
  }
  _check() {
    const b = this.budget;
    if (b.resolutions > MAX_OBJECT_RESOLUTIONS) {
      throw new BudgetExceeded("object-resolution", MAX_OBJECT_RESOLUTIONS, b.resolutions);
    }
    if (b.spans > MAX_SPAN_CHECKS) {
      throw new BudgetExceeded("span-check", MAX_SPAN_CHECKS, b.spans);
    }
    if (b.resolvedBytes > MAX_RESOLVED_BYTES) {
      throw new BudgetExceeded("resolved-input-bytes", MAX_RESOLVED_BYTES, b.resolvedBytes);
    }
  }
  _countPayload(v) {
    if (v === null || v === undefined) return;
    this.budget.resolvedBytes += Buffer.byteLength(JSON.stringify(v), "utf8");
  }
  getBuild(build_id) {
    this.budget.resolutions += 1;
    this._check();
    const r = this.inner.getBuild(build_id);
    this._countPayload(r);
    this._check();
    return r;
  }
  evidenceFor(control_id) {
    // One object resolution for the call plus one span check per record
    // returned; records are payload too.
    this.budget.resolutions += 1;
    this._check();
    const rows = this.inner.evidenceFor(control_id);
    this.budget.spans += rows.length;
    this._countPayload(rows);
    this._check();
    return rows;
  }
  resolveRun(run_id) {
    this.budget.resolutions += 1;
    this._check();
    const r = this.inner.resolveRun(run_id);
    this._countPayload(r);
    this._check();
    return r;
  }
  resolveArtifact(fixture_id) {
    this.budget.resolutions += 1;
    this._check();
    const a = this.inner.resolveArtifact(fixture_id);
    if (a) {
      this.budget.resolvedBytes += a.byte_length;
      this._check();
    }
    return a;
  }
  checkGrant(evidence_id) {
    this.budget.resolutions += 1;
    this._check();
    const g = this.inner.checkGrant(evidence_id);
    this._countPayload(g);
    this._check();
    return g;
  }
  checkObserver(observer_id) {
    this.budget.resolutions += 1;
    this._check();
    const o = this.inner.checkObserver(observer_id);
    this._countPayload(o);
    this._check();
    return o;
  }
}

function newBudget() {
  return { resolutions: 0, spans: 0, resolvedBytes: 0 };
}

// Exported for host-side budget tests (exact-limit / limit+1 per dimension).
export { BudgetedResolver, BudgetExceeded, BUDGET_LIMITS };
const BUDGET_LIMITS = Object.freeze({
  maxTaskBytes: MAX_TASK_BYTES,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  maxObjectResolutions: MAX_OBJECT_RESOLUTIONS,
  maxSpanChecks: MAX_SPAN_CHECKS,
  maxOutputRecords: MAX_OUTPUT_RECORDS,
  maxResolvedBytes: MAX_RESOLVED_BYTES,
});

export function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v !== null && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canonicalize(v[k]);
    return o;
  }
  return v;
}

export const canonicalJson = (v) => JSON.stringify(canonicalize(v));

function sha256Hex(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function deepEqual(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

/** Detached snapshot: caller mutation cannot alter fixtures or earlier results. */
function detach(v) {
  return JSON.parse(JSON.stringify(v));
}

function diag(code, severity, reason, control_id = null, evidence_id = null) {
  return { code, severity, control_id, evidence_id, reason };
}

function sortDiagnostics(ds) {
  const sevRank = { error: 0, warning: 1, info: 2 };
  return [...ds].sort(
    (a, b) =>
      sevRank[a.severity] - sevRank[b.severity] ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      String(a.control_id ?? "").localeCompare(String(b.control_id ?? "")) ||
      String(a.evidence_id ?? "").localeCompare(String(b.evidence_id ?? ""))
  );
}

function baseEnvelope(task_id) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: task_id ?? null,
    advisory: true,
    fixture_only: true,
    source_refs: [],
    diagnostics: [],
    quarantined_sources: [],
    routing_flags: [],
    complete: true,
  };
}

/** Structured denial: no exception, no default success, no domain output. */
function denial(task_id, code, reason, source_refs = []) {
  const env = baseEnvelope(task_id);
  env.source_refs = source_refs;
  env.status = "REFUSED";
  env.report_id = null;
  env.build_pin = null;
  env.results = [];
  env.contradictions = [];
  env.ledger_preview = [];
  env.coverage = { by_modality: {}, by_result: {}, by_assertion: {}, controls_total: 0, assertions_total: 0 };
  env.diagnostics = [diag(code, "error", reason)];
  return env;
}

/**
 * Pinned observation declarations on a run or artifact record (QAI-002).
 *
 * A run or artifact used as evidence provenance MUST declare what it
 * observed: either a single top-level (control_id, assertion_id, modality)
 * triple, or an `observations` array of such triples (suite-level records
 * observing several controls). Every entry must be complete — partial
 * metadata is not a binding. The mapping is read from the registered record
 * itself, never inferred from the candidate evidence record.
 *
 * Returns the list of complete declared observations (possibly empty).
 */
function declaredObservations(record) {
  const out = [];
  const push = (o) => {
    if (
      o !== null &&
      typeof o === "object" &&
      typeof o.control_id === "string" &&
      o.control_id.length > 0 &&
      typeof o.assertion_id === "string" &&
      o.assertion_id.length > 0 &&
      typeof o.modality === "string" &&
      o.modality.length > 0
    ) {
      out.push({ control_id: o.control_id, assertion_id: o.assertion_id, modality: o.modality });
    }
  };
  push(record);
  if (Array.isArray(record.observations)) {
    for (const o of record.observations) push(o);
  }
  return out;
}

/**
 * Bind one evidence record to the task's build pin and control.
 * Returns {usable, blocking, evidence, diagnostics:[], quarantined}.
 */
function bindEvidence(ev, task, control, context, budget) {
  const diagnostics = [];
  // 1. Schema of the resolver record itself (trust boundary).
  const sv = validateEvidenceRecord(ev);
  if (!sv.ok) {
    return {
      usable: false,
      blocking: false,
      evidence: null,
      diagnostics: sv.errors.map((e) =>
        diag("EVIDENCE_MALFORMED", "warning", `${e.code}: ${e.message}`, control.control_id, ev.evidence_id ?? null)
      ),
      quarantined: false,
    };
  }
  // 2. Injection scan: quarantined sources cannot support claims.
  const inj = scanRecord(ev);
  if (inj.injected) {
    diagnostics.push(
      diag(
        "INSTRUCTION_INJECTION",
        "warning",
        `seeded directive families [${inj.families.join(",")}] — source quarantined`,
        control.control_id,
        ev.evidence_id
      )
    );
    return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: true };
  }
  // 3. Observer authentication: the observer label is never trusted on its
  //    own — the observer must be registered and trusted by the harness.
  const obs = context.resolver.checkObserver(ev.fixture_observer_id);
  if (!obs.trusted) {
    diagnostics.push(
      diag("OBSERVER_UNTRUSTED", "error", `fixture observer "${ev.fixture_observer_id}" is not trusted: ${obs.reason}`, control.control_id, ev.evidence_id)
    );
    return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
  }
  // 4. Build binding: evidence build must equal the task pin via the registry.
  //    Task labels never establish build identity.
  const reg = context.resolver.getBuild(ev.build_id);
  const pin = task.build_pin;
  const buildOk =
    reg !== null &&
    ev.build_id === pin.build_id &&
    reg.repo === pin.repo &&
    reg.commit === pin.commit &&
    reg.environment === pin.environment &&
    ev.repo === pin.repo &&
    ev.commit === pin.commit &&
    ev.environment === pin.environment;
  if (!buildOk) {
    diagnostics.push(
      diag("WRONG_BUILD", "error", "evidence build does not match the inspected build pin", control.control_id, ev.evidence_id)
    );
    return { usable: false, blocking: true, evidence: null, diagnostics, quarantined: false };
  }
  // 5. Assertion binding: the evidence must name one of the control's assertions.
  if (!control.assertion_ids.includes(ev.assertion_id)) {
    diagnostics.push(
      diag("WRONG_ASSERTION", "warning", `assertion "${ev.assertion_id}" not requested for this control`, control.control_id, ev.evidence_id)
    );
    return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
  }
  // 6. Grant check: a denied or unreachable required read blocks, even for
  //    records that later prove unusable — the denial is recorded first.
  const grant = context.resolver.checkGrant(ev.evidence_id);
  if (!grant.allowed) {
    diagnostics.push(
      diag("READ_DENIED", "error", `required read denied: ${grant.reason}`, control.control_id, ev.evidence_id)
    );
    return { usable: false, blocking: true, evidence: null, diagnostics, quarantined: false };
  }
  // 7. Provenance pinning: every PASS/FAIL must rest on a registered,
  //    verifiable run, artifact, or source observation. A record with neither
  //    a run nor an artifact is unpinned and cannot support a claim.
  if (ev.run_id === null && ev.artifact_ref === null) {
    diagnostics.push(
      diag("UNPINNED_OBSERVATION", "error", "evidence names no registered run, artifact, or source observation", control.control_id, ev.evidence_id)
    );
    return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
  }
  // 8. Run binding: run_id is independently resolved with full provenance —
  //    repository identity, build, control, assertion, and modality are all
  //    bound to the observation. The observation binding is MANDATORY: a run
  //    that declares no pinned observation covering this evidence cannot
  //    support a claim — absence of provenance is never treated as
  //    sufficient, and the mapping is never inferred from the candidate
  //    evidence record. A suite-level run may omit per-control metadata only
  //    when its registered `observations` list supplies the mapping.
  if (ev.run_id !== null) {
    const run = context.resolver.resolveRun(ev.run_id);
    if (run === null) {
      diagnostics.push(
        diag("FAKE_RUN", "error", `run_id "${ev.run_id}" not independently registered for this build`, control.control_id, ev.evidence_id)
      );
      return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
    }
    const mismatches = [];
    if (run.build_id !== pin.build_id) mismatches.push("build_id");
    if (run.repo !== pin.repo) mismatches.push("repo");
    if (run.commit !== pin.commit) mismatches.push("commit");
    if (run.environment !== pin.environment) mismatches.push("environment");
    if (mismatches.length > 0) {
      diagnostics.push(
        diag("RUN_MISMATCH", "error", `run observation mismatches [${mismatches.join(",")}]`, control.control_id, ev.evidence_id)
      );
      return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
    }
    const obs = declaredObservations(run);
    if (obs.length === 0) {
      diagnostics.push(
        diag(
          "UNBOUND_OBSERVATION",
          "error",
          "run declares no pinned observation binding repo/build/environment/control/assertion/modality",
          control.control_id,
          ev.evidence_id
        )
      );
      return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
    }
    const covered = obs.some(
      (o) => o.control_id === ev.control_id && o.assertion_id === ev.assertion_id && o.modality === ev.modality
    );
    if (!covered) {
      diagnostics.push(
        diag(
          "RUN_MISMATCH",
          "error",
          `run observation binding covers [${obs.map((o) => `${o.control_id}/${o.assertion_id}/${o.modality}`).join(", ")}] — not control "${ev.control_id}" assertion "${ev.assertion_id}" modality "${ev.modality}"`,
          control.control_id,
          ev.evidence_id
        )
      );
      return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
    }
  }
  // 9. Artifact binding: digest recomputed over actual registered bytes, and
  //    the artifact MUST declare a pinned control/assertion/modality
  //    observation association — a hash of generic bytes is not an
  //    observation binding, and the association is not optional metadata.
  if (ev.artifact_ref !== null) {
    const art = context.resolver.resolveArtifact(ev.artifact_ref.fixture_id);
    const artOk =
      art !== null &&
      art.sha256 === ev.artifact_ref.sha256 &&
      art.media_type === ev.artifact_ref.media_type &&
      art.byte_length === ev.artifact_ref.byte_length;
    if (!artOk) {
      diagnostics.push(
        diag("HASH_MISMATCH", "error", "artifact digest/bytes do not match the registered artifact", control.control_id, ev.evidence_id)
      );
      return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
    }
    const aObs = declaredObservations(art);
    if (aObs.length === 0) {
      diagnostics.push(
        diag(
          "UNBOUND_ARTIFACT",
          "error",
          "artifact declares no pinned control/assertion/modality observation association",
          control.control_id,
          ev.evidence_id
        )
      );
      return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
    }
    const aCovered = aObs.some(
      (o) => o.control_id === ev.control_id && o.assertion_id === ev.assertion_id && o.modality === ev.modality
    );
    if (!aCovered) {
      diagnostics.push(
        diag("ARTIFACT_MISMATCH", "error", "artifact observation association does not cover this evidence's control/assertion/modality", control.control_id, ev.evidence_id)
      );
      return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
    }
  }
  // 10. Structured assertion required: screenshot presence alone proves nothing.
  if (ev.expected === null || ev.expected === undefined || ev.observed === null || ev.observed === undefined) {
    diagnostics.push(
      diag(
        "INCOMPLETE_ASSERTION",
        "warning",
        "no structured observed-vs-expected assertion (artifact presence alone never proves behavior)",
        control.control_id,
        ev.evidence_id
      )
    );
    return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
  }
  // 11. Computed match decides; a contradicting claimed outcome is flagged.
  const match = deepEqual(ev.expected, ev.observed);
  if ((ev.outcome === "pass") !== match) {
    diagnostics.push(
      diag("OUTCOME_MISMATCH", "warning", `claimed outcome "${ev.outcome}" contradicts computed observed-vs-expected`, control.control_id, ev.evidence_id)
    );
  }
  return {
    usable: true,
    blocking: false,
    evidence: { ...detach(ev), _match: match },
    diagnostics,
    quarantined: false,
  };
}

function ledgerStatus(result) {
  switch (result) {
    case "PASS":
      return "Verified";
    case "FAIL":
      return "Failed";
    case "BLOCKED":
    case "REFUSED":
      return "Blocked";
    default:
      return "Not Tested";
  }
}

function processControl(task, control, context, budget, acc) {
  const result = {
    control_id: control.control_id,
    kind: control.kind,
    requested_operation: control.requested_operation,
    result: "UNVERIFIED",
    assertion_results: [],
    per_modality: [],
    evidence_ids: [],
    action_taken: "none",
    expected: null,
    observed: null,
    diagnostic_codes: [],
  };
  const codes = new Set();
  const note = (d) => {
    acc.diagnostics.push(d);
    codes.add(d.code);
  };

  // 0. Control-identity injection: a tainted control_id/assertion_id cannot be
  //    verified — evidence naming it would be quarantined as well. Quarantine
  //    the control and verify nothing under it.
  const idInj = scanInjection(control.control_id);
  const assertionInj = { injected: false, families: [] };
  for (const aid of control.assertion_ids) {
    const s = scanInjection(aid);
    if (s.injected) {
      assertionInj.injected = true;
      for (const f of s.families) if (!assertionInj.families.includes(f)) assertionInj.families.push(f);
    }
  }
  if (idInj.injected || assertionInj.injected) {
    const fams = [...new Set([...idInj.families, ...assertionInj.families])].sort();
    result.result = "UNVERIFIED";
    note(diag("INSTRUCTION_INJECTION", "warning", `seeded directive families [${fams.join(",")}] in control identity — control quarantined`, control.control_id));
    note(diag("NO_EVIDENCE", "info", "no usable evidence for quarantined control", control.control_id));
    acc.quarantined.push(`control:${control.control_id}`);
    result.diagnostic_codes = [...codes].sort();
    return result;
  }

  // Exercise path: the prototype has no execution adapter and never performs actions.
  if (control.requested_operation === "exercise") {
    if (PROHIBITED_EXERCISE_KINDS.has(control.kind)) {
      result.result = "REFUSED";
      note(diag("ACTION_DENIED", "error", `exercise of "${control.kind}" is prohibited — denial only, nothing executed`, control.control_id));
    } else {
      result.result = "REFUSED";
      note(diag("EXERCISE_UNSUPPORTED", "error", `no control-execution adapter in this prototype — "${control.kind}" not exercised`, control.control_id));
    }
    result.diagnostic_codes = [...codes].sort();
    return result;
  }

  // Report path: gather and bind evidence.
  // Every resolver access is counted and bounded by the BudgetedResolver
  // wrapper (object resolutions, span checks, resolved bytes); exhaustion
  // throws BudgetExceeded, which run() converts to a structured denial.
  const candidates = context.resolver.evidenceFor(control.control_id);
  const byAssertion = new Map(); // assertion_id -> {usable: [], blocking: bool}
  for (const aid of control.assertion_ids) byAssertion.set(aid, { usable: [], blocking: false, diags: [] });
  for (const ev of candidates) {
    const b = bindEvidence(ev, task, control, context, budget);
    for (const d of b.diagnostics) note(d);
    if (b.quarantined) acc.quarantined.push(ev.evidence_id ?? "unknown");
    if (b.blocking) {
      const slot = byAssertion.get(ev.assertion_id);
      if (slot) slot.blocking = true;
      else {
        // blocking evidence for an unrequested assertion still blocks the control
        acc.controlBlocking.add(control.control_id);
      }
    }
    if (b.usable) {
      const slot = byAssertion.get(b.evidence.assertion_id);
      slot.usable.push(b.evidence);
    }
  }

  // Per-assertion classification.
  // Priority: FAIL > BLOCKED > UNVERIFIED > PASS. A verified observed failure
  // in ANY modality with usable evidence fails the assertion (contradictions
  // can never be averaged away); mandatory blocking evidence propagates even
  // alongside usable records, so blocking can never be silently ignored.
  let controlFail = false;
  let controlBlocked = acc.controlBlocking.has(control.control_id);
  let controlUnverified = false;
  const expectedMap = {};
  const observedMap = {};
  for (const aid of control.assertion_ids) {
    const slot = byAssertion.get(aid);
    const ar = { assertion_id: aid, result: "UNVERIFIED", evidence_ids: [], expected: null, observed: null };
    const usable = slot.usable;
    ar.evidence_ids = usable.map((e) => e.evidence_id);
    if (usable.length > 0) {
      ar.expected = usable[0].expected;
      ar.observed = usable[0].observed;
      expectedMap[aid] = usable[0].expected;
      observedMap[aid] = usable[0].observed;
    }
    const anyFail = usable.some((e) => !e._match);
    if (usable.length === 0) {
      if (slot.blocking) {
        ar.result = "BLOCKED";
        controlBlocked = true;
      } else {
        ar.result = "UNVERIFIED";
        controlUnverified = true;
        note(diag("NO_EVIDENCE", "info", `no usable evidence for assertion "${aid}"`, control.control_id));
      }
    } else if (anyFail) {
      // A verified observed failure in any modality (required or not) fails
      // the assertion; the contradiction record below retains both sides.
      ar.result = "FAIL";
      controlFail = true;
    } else if (slot.blocking) {
      // Usable evidence exists, but mandatory blocking evidence (wrong build,
      // denied read) was recorded for this assertion: it propagates.
      ar.result = "BLOCKED";
      controlBlocked = true;
    } else {
      let gap = false;
      for (const m of control.required_modalities) {
        if (!usable.some((e) => e.modality === m)) {
          gap = true;
          note(diag("MODALITY_GAP", "info", `required modality "${m}" has no usable evidence`, control.control_id));
        }
      }
      if (gap) {
        ar.result = "UNVERIFIED";
        controlUnverified = true;
      } else {
        ar.result = "PASS";
      }
    }
    // Contradiction: opposing outcomes retained, both modalities kept.
    const matched = usable.filter((e) => e._match);
    const mismatched = usable.filter((e) => !e._match);
    if (matched.length > 0 && mismatched.length > 0) {
      acc.contradictions.push({
        control_id: control.control_id,
        assertion_id: aid,
        evidence_a: mismatched[0].evidence_id,
        evidence_b: matched[0].evidence_id,
        modalities: [...new Set(usable.map((e) => e.modality))].sort(),
      });
      acc.routingFlags.add("CONTRADICTION_PRESENT");
    }
    result.assertion_results.push(ar);
    for (const e of usable) {
      if (!result.evidence_ids.includes(e.evidence_id)) result.evidence_ids.push(e.evidence_id);
    }
    acc.coverageByAssertion[aid] = (acc.coverageByAssertion[aid] ?? 0) + 1;
  }

  if (controlFail) result.result = "FAIL";
  else if (controlBlocked) result.result = "BLOCKED";
  else if (controlUnverified) result.result = "UNVERIFIED";
  else result.result = "PASS";

  // Per-modality states are computed from each modality's OWN verified
  // observations — never copied from the aggregate assertion result. A
  // modality FAILs when any of its usable evidence mismatches; it PASSes
  // when it has usable evidence and all of it matches; otherwise UNVERIFIED.
  for (const m of MODALITIES) {
    const mev = [];
    for (const ar of result.assertion_results) {
      const slot = byAssertion.get(ar.assertion_id);
      for (const e of slot.usable) {
        if (e.modality === m && !mev.includes(e.evidence_id)) mev.push(e.evidence_id);
      }
    }
    let mres = "UNVERIFIED";
    if (mev.length > 0) {
      const anyModalityFail = result.assertion_results.some((ar) => {
        const slot = byAssertion.get(ar.assertion_id);
        return slot.usable.some((e) => e.modality === m && !e._match);
      });
      mres = anyModalityFail ? "FAIL" : "PASS";
    }
    result.per_modality.push({ modality: m, result: mres, evidence_ids: mev.sort() });
    if (mev.length > 0) acc.coverageByModality[m] = (acc.coverageByModality[m] ?? 0) + mev.length;
  }

  result.expected = Object.keys(expectedMap).length ? expectedMap : null;
  result.observed = Object.keys(observedMap).length ? observedMap : null;
  result.diagnostic_codes = [...codes].sort();
  if (result.result === "FAIL") acc.routingFlags.add("FAILURE_PRESENT");
  if (result.result === "BLOCKED") acc.routingFlags.add("BLOCKED_EVIDENCE");
  return result;
}

/**
 * run(task, context) -> result.
 * context: {clock: ISO-8601 Z string (fixed, injected), resolver: FixtureResolver,
 *           recordToolCall?: fn} — context is injected separately, never nested in task.
 * Pure: no filesystem, no network, no tool calls, no control execution.
 */
export function run(task, context) {
  const taskId = task && typeof task === "object" ? task.task_id : null;
  // Clock validation (injected clock is validated, never trusted blindly).
  // An invalid clock yields a named denial, never a default success.
  const clock = context?.clock;
  if (typeof clock !== "string" || !isValidDateString(clock) || !Number.isFinite(Date.parse(clock))) {
    return denial(taskId, "INVALID_CLOCK", "context.clock must be a valid finite UTC ISO timestamp");
  }
  if (!context || typeof context.resolver !== "object") {
    return denial(taskId, "INVALID_INPUT", "context.resolver (fixture adapter) is required");
  }

  // Task schema validation.
  const tv = validateTask(task);
  if (!tv.ok) {
    const d = denial(taskId, "INVALID_INPUT", `task schema invalid: ${tv.errors[0].code} at ${tv.errors[0].path}`);
    d.diagnostics = tv.errors.slice(0, 16).map((e) => diag(e.code, "error", `${e.message} @ ${e.path}`));
    return d;
  }

  // Declared evidence sources: this fixture prototype cannot independently
  // resolve declared source pins, so it explicitly refuses tasks that declare
  // any — a declared-but-unresolvable source is never echoed as provenance
  // supporting success.
  if (task.evidence_sources.length > 0) {
    return denial(task.task_id, "UNSUPPORTED_SOURCE", "declared evidence sources cannot be independently resolved by this fixture adapter — supply none");
  }

  // Input limits.
  const taskBytes = Buffer.byteLength(JSON.stringify(task), "utf8");
  if (taskBytes > MAX_TASK_BYTES) {
    return denial(task.task_id, "INPUT_LIMIT", `task exceeds ${MAX_TASK_BYTES} bytes`);
  }

  // Task-label injection scan (labels never establish build identity).
  const acc = {
    diagnostics: [],
    quarantined: [],
    contradictions: [],
    routingFlags: new Set(),
    controlBlocking: new Set(),
    coverageByModality: {},
    coverageByAssertion: {},
  };
  const labelInj = scanTaskLabels(task);
  if (labelInj.injected) {
    acc.diagnostics.push(
      diag("INSTRUCTION_INJECTION", "warning", `seeded directive families [${labelInj.families.join(",")}] in task labels — labels quarantined, build identity still registry-only`)
    );
    acc.quarantined.push("task:surface");
  }

  // Budgeted resolver: every access (build/run/artifact/grant/observer reads,
  // ledger evidence reads included) counts against the object-resolution,
  // span-check, and resolved-byte budgets. Exhaustion throws BudgetExceeded.
  const budget = newBudget();
  const resolver = new BudgetedResolver(context.resolver, budget);
  const bctx = { ...context, resolver };

  try {
    // Trusted build binding for the pin itself.
    const pin = task.build_pin;
    const reg = resolver.getBuild(pin.build_id);
    if (
      reg === null ||
      reg.repo !== pin.repo ||
      reg.commit !== pin.commit ||
      reg.environment !== pin.environment
    ) {
      const d = denial(task.task_id, "INVALID_INPUT", "build_pin.build_id is not registered for the pinned repo/commit/environment");
      d.diagnostics = [diag("UNREGISTERED_BUILD_PIN", "error", "build identity binds only through the trusted registry")];
      return d;
    }

    const env = baseEnvelope(task.task_id);
    env.report_id = "qair-" + sha256Hex(canonicalJson({ t: task.task_id, p: pin, c: task.controls.map((x) => x.control_id).sort() })).slice(0, 16);
    env.build_pin = detach(pin);

    if (task.controls.length === 0) {
      acc.diagnostics.push(diag("EMPTY_SURFACE", "info", "surface declares no controls — nothing to inspect"));
    }

    env.results = task.controls.map((ctrl) => processControl(task, ctrl, bctx, budget, acc));

    // Output-record budget: control results + assertion results emitted.
    const outputRecords =
      env.results.length + env.results.reduce((n, r) => n + r.assertion_results.length, 0);
    if (outputRecords > MAX_OUTPUT_RECORDS) {
      throw new BudgetExceeded("output-record", MAX_OUTPUT_RECORDS, outputRecords);
    }

    // Overall status.
    const refusedAll = env.results.length > 0 && env.results.every((r) => r.result === "REFUSED");
    if (refusedAll) env.status = "REFUSED";
    else if (env.results.some((r) => r.result === "BLOCKED")) env.status = "BLOCKED";
    else env.status = "REPORTED";

    env.contradictions = acc.contradictions;
    env.quarantined_sources = [...new Set(acc.quarantined)].sort();

    // Inert ledger-row preview: advisory only, never updates the real ledger.
    env.ledger_preview = env.results.map((r) => {
      const ctrl = task.controls.find((x) => x.control_id === r.control_id);
      return {
        synthetic: true,
        page_route: task.surface.route,
        control: r.control_id,
        kind: ctrl.kind,
        status: ledgerStatus(r.result),
        last_verified: latestTimestamp(task, r, bctx),
        deployed_commit_tested: pin.commit,
        verified_by: r.per_modality.filter((m) => m.evidence_ids.length > 0).map((m) => m.modality).join("+") || "—",
        notes: r.diagnostic_codes.length ? r.diagnostic_codes.join(",") : `${r.result} — synthetic fixture evidence`,
      };
    });

    // Coverage counts by modality and assertion (never a misleading global verified %).
    const byResult = {};
    for (const r of env.results) byResult[r.result] = (byResult[r.result] ?? 0) + 1;
    env.coverage = {
      by_modality: acc.coverageByModality,
      by_result: byResult,
      by_assertion: acc.coverageByAssertion,
      controls_total: env.results.length,
      assertions_total: env.results.reduce((n, r) => n + r.assertion_results.length, 0),
    };

    env.routing_flags = [...acc.routingFlags].sort();
    env.diagnostics = sortDiagnostics(acc.diagnostics);

    const outBytes = Buffer.byteLength(JSON.stringify(env), "utf8");
    if (outBytes > MAX_OUTPUT_BYTES) {
      return denial(task.task_id, "OUTPUT_LIMIT", `output exceeds ${MAX_OUTPUT_BYTES} bytes`);
    }
    return env;
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      const d = denial(task.task_id, "BUDGET_EXCEEDED", e.message);
      d.diagnostics = [diag("BUDGET_EXCEEDED", "error", e.message), ...sortDiagnostics(acc.diagnostics)].slice(0, 16);
      return d;
    }
    throw e;
  }
}

/** Latest usable evidence timestamp for a control, or null. */
function latestTimestamp(task, result, context) {
  let best = null;
  const evs = context.resolver.evidenceFor(result.control_id);
  for (const e of evs) {
    if (!result.evidence_ids.includes(e.evidence_id)) continue;
    if (typeof e.timestamp === "string" && (best === null || e.timestamp > best)) best = e.timestamp;
  }
  return best;
}
