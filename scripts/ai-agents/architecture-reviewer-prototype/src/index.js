/**
 * index.js — public entry for the architecture-reviewer prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. The agent has no file-write API, no
 * network, no tool calls: it returns a detached advisory JSON snapshot.
 * Advisory output is never an execution token: authorization_granted is
 * always false, and verdict proposals are advisory only.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import { validateTask, SchemaError } from "./schemas.js";
import { CHECK_IDS } from "./checks.js";
import { scanInjection } from "./injection.js";
import { resolveDesign, verifySpan, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { evaluateReview, verifyEvidenceRefs } from "./reviewer.js";
import { evaluateGate } from "./gates.js";

export const AGENT_ID = "architecture-reviewer";
export const SCHEMA_VERSION = "1";

function taskIdOf(task) {
  try {
    return `ar-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "ar-invalid-task";
  }
}

function baseDenial(task, status, code, severity, reason, sourceRef) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: [],
    status,
    diagnostics: [{ code, severity, source_ref: sourceRef ? { ...sourceRef } : null, record_id: null, reason }],
    quarantined_sources: [],
    routing_flags: [],
    complete: false,
    verdict_proposal: null,
    authorization_granted: false,
  };
}

function envelope(task, payload) {
  const refs = [];
  if (task && task.design_ref) refs.push({ ...task.design_ref });
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: refs,
    ...payload,
  };
}

/** Output-record budget model: same defined records as the reviewer. */
function outputRecords(result) {
  return (
    (result.findings?.length ?? 0) +
    (result.contradictions?.length ?? 0) +
    (result.coverage?.required?.length ?? 0) +
    (result.diagnostics?.length ?? 0) +
    (result.quarantined_sources?.length ?? 0) +
    (result.routing_flags?.length ?? 0) +
    (result.source_refs?.length ?? 0) +
    (result.gate?.checks?.length ?? 0)
  );
}

/**
 * Final-envelope budget gate: records counted over the defined output
 * model, bytes measured on the canonical JSON of the EXACT public
 * envelope the caller receives. Exhaustion yields a small complete:false
 * refusal with no domain success.
 */
function finalEnvelopeWithinBudget(result) {
  if (outputRecords(result) > BUDGET_LIMITS.maxOutputRecords) return false;
  return canonicalByteLength(result) <= BUDGET_LIMITS.maxOutputBytes;
}

function smallOutputLimitRefusal(task) {
  const r = baseDenial(task, "REFUSED", "OUTPUT_LIMIT", "error", `final output envelope exceeds ${BUDGET_LIMITS.maxOutputBytes} bytes`, null);
  return r;
}

function validateClock(context) {
  const clock = context && context.clock;
  if (!Number.isFinite(clock)) throw new SchemaError("context.clock must be a finite number");
}

/**
 * Run the review. A malformed request, budget exhaustion, prohibited
 * action or unsupported task yields a structured REFUSED/BLOCKED denial —
 * never an exception and never a default success.
 */
export function run(task, context) {
  let kind;
  try {
    validateClock(context);
    ({ kind } = validateTask(task));
  } catch (e) {
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", e.message, null);
    throw e;
  }

  // AR-004: the task's own UTF-8 payload is charged before anything
  // consults it. An oversized request fails closed with INPUT_LIMIT and
  // no partial success — the final output gate is not a substitute.
  let budget;
  try {
    budget = makeBudget();
    budget.countPayload(canonicalJson(task), "task payload");
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message, null);
    throw e;
  }

  if (kind === "prohibited") {
    return {
      ...baseDenial(task, "REFUSED", "ACTION_DENIED", "critical", `prohibited action '${task.requested_action}': this agent performs advisory reviews only`, task.design_ref ?? null),
      verdict_proposal: null,
      authorization_granted: false,
    };
  }

  if (kind === "check-gate") {
    try {
      const payload = evaluateGate(task, context, budget);
      const result = envelope(task, payload);
      if (!finalEnvelopeWithinBudget(result)) return smallOutputLimitRefusal(task);
      return result;
    } catch (e) {
      if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message, null);
      if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", e.message, null);
      throw e;
    }
  }

  // kind === "review"
  try {
    const requiredCheckIds = (task.required_check_ids ?? []).length > 0 ? task.required_check_ids : CHECK_IDS;

    // 1. Resolve and bind the design source.
    const { bytes } = resolveDesign(task.design_ref, task.base_pin, context, budget);

    // 2. Injection scan before any review claims.
    const injection = scanInjection(bytes);
    if (injection.instructionInjection.length > 0) {
      const r = baseDenial(task, "BLOCKED", "INSTRUCTION_INJECTION", "critical", "design text contains injected reviewer instructions; source quarantined, no trustworthy review basis", task.design_ref);
      r.quarantined_sources = [{ ...task.design_ref }];
      r.verdict_proposal = { value: "NO-GO", advisory: true, reason: "inability to review: injected content quarantined" };
      r.authorization_granted = false;
      return r;
    }

    // 3. AR-003: verify caller-supplied evidence refs BEFORE any success
    //    verdict. Wrong source/quote/bounds or unreachable evidence is an
    //    inability to review: BLOCKED, explicit NO-GO, complete:false.
    //    No GO is ever supported by failed evidence.
    const evDiags = verifyEvidenceRefs(task, bytes, budget);
    if (evDiags.length > 0) {
      const r = baseDenial(task, "BLOCKED", evDiags[0].code, "error", `submitted evidence failed verification: ${evDiags[0].reason}`, task.design_ref);
      r.diagnostics = evDiags;
      r.verdict_proposal = { value: "NO-GO", advisory: true, reason: "inability to review: submitted required evidence failed verification" };
      r.authorization_granted = false;
      return r;
    }

    // 4. Evaluate.
    const payload = evaluateReview(task, task.design_ref, bytes, requiredCheckIds, injection, budget, context);
    payload.diagnostics = [];

    // 5. Quarantined sources: none for a clean review path (spoof is
    //    neutralized, not quarantined). complete reflects coverage.
    payload.quarantined_sources = [];
    payload.routing_flags = [];
    if (injection.authoritySpoof.length > 0) {
      payload.routing_flags = ["AUTHORITY_SPOOF_NEUTRALIZED"];
    }

    const result = envelope(task, payload);
    if (!finalEnvelopeWithinBudget(result)) return smallOutputLimitRefusal(task);
    return result;
  } catch (e) {
    if (e instanceof ResolutionError) {
      const r = baseDenial(task, "BLOCKED", e.code, "error", e.message, task.design_ref ?? null);
      r.verdict_proposal = { value: "NO-GO", advisory: true, reason: "inability to review: required evidence unreachable" };
      r.authorization_granted = false;
      return r;
    }
    if (e instanceof BudgetError) {
      const status = e.code === "BUDGET_EXCEEDED" ? "BLOCKED" : "REFUSED";
      const r = baseDenial(task, status, e.code, "error", e.message, task.design_ref ?? null);
      r.verdict_proposal = e.code === "BUDGET_EXCEEDED" ? { value: "NO-GO", advisory: true, reason: "inability to review: budget exhausted" } : null;
      r.authorization_granted = false;
      return r;
    }
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", e.message, null);
    throw e;
  }
}

export { validateTask, CHECK_IDS, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
export { verifySpan };
