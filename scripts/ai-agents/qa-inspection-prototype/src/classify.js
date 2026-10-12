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

const MAX_TASK_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_EVIDENCE_SPANS = 512;
const MAX_RESOLUTIONS = 64 + 512;

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
  // 3. Build binding: evidence build must equal the task pin via the registry.
  //    Task labels never establish build identity.
  const reg = context.resolver.getBuild(ev.build_id);
  budget.resolutions += 1;
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
  // 4. Assertion binding: the evidence must name one of the control's assertions.
  if (!control.assertion_ids.includes(ev.assertion_id)) {
    diagnostics.push(
      diag("WRONG_ASSERTION", "warning", `assertion "${ev.assertion_id}" not requested for this control`, control.control_id, ev.evidence_id)
    );
    return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
  }
  // 5. Run binding: run_id is independently resolved; a fake run fails binding.
  if (ev.run_id !== null) {
    const run = context.resolver.resolveRun(ev.run_id);
    budget.resolutions += 1;
    const runOk =
      run !== null &&
      run.build_id === pin.build_id &&
      run.commit === pin.commit &&
      run.environment === pin.environment;
    if (!runOk) {
      diagnostics.push(
        diag("FAKE_RUN", "error", `run_id "${ev.run_id}" not independently registered for this build`, control.control_id, ev.evidence_id)
      );
      return { usable: false, blocking: false, evidence: null, diagnostics, quarantined: false };
    }
  }
  // 6. Artifact binding: digest recomputed over actual registered bytes.
  if (ev.artifact_ref !== null) {
    const art = context.resolver.resolveArtifact(ev.artifact_ref.fixture_id);
    budget.resolutions += 1;
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
  }
  // 7. Grant check: a denied or unreachable required read blocks.
  const grant = context.resolver.checkGrant(ev.evidence_id);
  budget.resolutions += 1;
  if (!grant.allowed) {
    diagnostics.push(
      diag("READ_DENIED", "error", `required read denied: ${grant.reason}`, control.control_id, ev.evidence_id)
    );
    return { usable: false, blocking: true, evidence: null, diagnostics, quarantined: false };
  }
  // 8. Structured assertion required: screenshot presence alone proves nothing.
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
  // 9. Computed match decides; a contradicting claimed outcome is flagged.
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
  const candidates = context.resolver.evidenceFor(control.control_id);
  budget.resolutions += 1;
  const byAssertion = new Map(); // assertion_id -> {usable: [], blocking: bool}
  for (const aid of control.assertion_ids) byAssertion.set(aid, { usable: [], blocking: false, diags: [] });
  for (const ev of candidates) {
    if (budget.resolutions > MAX_RESOLUTIONS) {
      note(diag("BUDGET_EXCEEDED", "error", "resolution budget exhausted", control.control_id));
      break;
    }
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
    if (usable.length === 0) {
      if (slot.blocking) {
        ar.result = "BLOCKED";
        controlBlocked = true;
      } else {
        ar.result = "UNVERIFIED";
        controlUnverified = true;
        note(diag("NO_EVIDENCE", "info", `no usable evidence for assertion "${aid}"`, control.control_id));
      }
    } else {
      // Required modalities must each be verified.
      let fail = false;
      let gap = false;
      for (const m of control.required_modalities) {
        const mev = usable.filter((e) => e.modality === m);
        if (mev.length === 0) {
          gap = true;
          note(diag("MODALITY_GAP", "info", `required modality "${m}" has no usable evidence`, control.control_id));
        } else if (mev.some((e) => !e._match)) {
          fail = true;
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
      if (fail) {
        ar.result = "FAIL";
        controlFail = true;
      } else if (gap) {
        ar.result = "UNVERIFIED";
        controlUnverified = true;
      } else {
        ar.result = "PASS";
      }
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

  for (const m of MODALITIES) {
    const mev = [];
    for (const ar of result.assertion_results) {
      const slot = byAssertion.get(ar.assertion_id);
      for (const e of slot.usable) if (e.modality === m && !mev.includes(e.evidence_id)) mev.push(e.evidence_id);
    }
    const mResults = result.assertion_results.filter((ar) => {
      const slot = byAssertion.get(ar.assertion_id);
      return slot.usable.some((e) => e.modality === m);
    }).map((ar) => ar.result);
    const mres = mResults.includes("FAIL") ? "FAIL" : mResults.includes("BLOCKED") ? "BLOCKED" : mResults.includes("UNVERIFIED") ? "UNVERIFIED" : mResults.length ? "PASS" : "UNVERIFIED";
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
  const clock = context?.clock;
  if (typeof clock !== "string" || !isValidDateString(clock) || !Number.isFinite(Date.parse(clock))) {
    return denial(taskId, "INVALID_INPUT", "context.clock must be a valid finite UTC ISO timestamp");
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

  // Trusted build binding for the pin itself.
  const budget = { resolutions: 0 };
  const pin = task.build_pin;
  const reg = context.resolver.getBuild(pin.build_id);
  budget.resolutions += 1;
  if (
    reg === null ||
    reg.repo !== pin.repo ||
    reg.commit !== pin.commit ||
    reg.environment !== pin.environment
  ) {
    const d = denial(task.task_id, "INVALID_INPUT", "build_pin.build_id is not registered for the pinned repo/commit/environment");
    d.diagnostics = [diag("UNREGISTERED_BUILD_PIN", "error", "build identity binds only through the trusted registry")];
    d.source_refs = detach(task.evidence_sources);
    return d;
  }

  const env = baseEnvelope(task.task_id);
  env.source_refs = detach(task.evidence_sources);
  env.report_id = "qair-" + sha256Hex(canonicalJson({ t: task.task_id, p: pin, c: task.controls.map((x) => x.control_id).sort() })).slice(0, 16);
  env.build_pin = detach(pin);

  if (task.controls.length === 0) {
    acc.diagnostics.push(diag("EMPTY_SURFACE", "info", "surface declares no controls — nothing to inspect"));
  }

  env.results = task.controls.map((ctrl) => processControl(task, ctrl, context, budget, acc));
  if (budget.resolutions > MAX_RESOLUTIONS) {
    const d = denial(task.task_id, "BUDGET_EXCEEDED", "resolution budget exhausted");
    d.diagnostics = sortDiagnostics(acc.diagnostics);
    return d;
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
      last_verified: latestTimestamp(task, r, context),
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
