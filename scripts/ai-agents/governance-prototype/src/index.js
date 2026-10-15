/**
 * index.js — public entry for the governance prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. The agent has no file-write API, no
 * network, no tool calls: it returns a detached advisory JSON snapshot.
 * Advisory output is never an execution token. A malformed request,
 * budget exhaustion, prohibited action, injection or unsupported state
 * yields a structured REFUSED/denial — never an exception and never a
 * default success.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import { validateTask, validateContext, SchemaError } from "./schemas.js";
import { evaluate } from "./evaluate.js";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "./resolver.js";

export const AGENT_ID = "governance";
export const SCHEMA_VERSION = "1";

function taskIdOf(task) {
  try {
    return `gov-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "gov-invalid-task";
  }
}

function baseDenial(task, status, code, severity, reason) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: [],
    status,
    validity: "UNGROUNDED",
    classification: "DENIED",
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    quarantined_sources: [],
    routing_flags: [],
    complete: false,
    policy_rule_cited: [],
    registration_refs: [],
    evidence_links: [],
    requirements: { satisfied: [], outstanding: [] },
    responsible_actor: null,
    evaluation_binding: null,
    evaluation_pins: null,
    authorization_granted: false,
    execution_performed: false,
    uncertainty_flags: [],
  };
}

function envelope(task, payload) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: [],
    ...payload,
  };
}

/** Output-record budget model over the defined output records. */
function outputRecords(result) {
  const reqs = result.requirements ?? { satisfied: [], outstanding: [] };
  return (
    (reqs.satisfied?.length ?? 0) +
    (reqs.outstanding?.length ?? 0) +
    (result.diagnostics?.length ?? 0) +
    (result.quarantined_sources?.length ?? 0) +
    (result.policy_rule_cited?.length ?? 0) +
    (result.registration_refs?.length ?? 0) +
    (result.evidence_links?.length ?? 0) +
    (result.routing_flags?.length ?? 0) +
    (result.uncertainty_flags?.length ?? 0)
  );
}

function finalEnvelopeWithinBudget(result) {
  if (outputRecords(result) > BUDGET_LIMITS.maxOutputRecords) return false;
  return canonicalByteLength(result) <= BUDGET_LIMITS.maxOutputBytes;
}

export function run(task, context) {
  let validated;
  try {
    const clock = context && context.clock;
    if (!Number.isFinite(clock)) throw new SchemaError("context.clock must be a finite number");
    validated = validateTask(task);
  } catch (e) {
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", e.message);
    throw e;
  }

  let budget;
  try {
    budget = makeBudget();
    budget.countPayload(canonicalJson(task), "task payload");
    if (task.payload_context.evidence_record_ids.length > BUDGET_LIMITS.maxSourceObjects) {
      throw new BudgetError("INPUT_LIMIT", "evidence_record_ids exceeds the 64 source-object budget");
    }
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message);
    throw e;
  }

  // Prohibited agent operations refuse before any evaluation.
  if (validated.requested_action === "execute_action") {
    return baseDenial(
      task,
      "REFUSED",
      "ACTION_DENIED",
      "critical",
      `prohibited operation '${validated.requested_action}': classify is advisory only; this agent cannot execute, approve, merge, deploy, activate, write, spend or send`
    );
  }

  let ctx;
  try {
    // GOV-002: charge the entire host context (every constituent byte exactly
    // once, canonical form) BEFORE any traversal. validateContext still
    // enforces the object-count caps afterwards. A non-serializable context
    // fails closed as invalid input, never an exception.
    try {
      budget.countPayload(canonicalJson(context), "host context");
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      throw new SchemaError("context is not JSON-serializable");
    }
    ctx = validateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", `context: ${e.message}`);
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  try {
    const payload = evaluate(validated, ctx, budget);
    // GOV-003: the envelope cites every verified source consulted during
    // evaluation, deterministically ordered. Quarantined sources were
    // dropped at quarantine time and never appear here.
    const result = envelope(task, {
      status: payload.status,
      validity: payload.validity,
      classification: payload.classification,
      source_refs: budget.listedSourceRefs(),
      diagnostics: payload.diagnostics,
      quarantined_sources: payload.quarantined_sources,
      routing_flags: payload.routing_flags,
      complete: payload.complete === true,
      policy_rule_cited: payload.policy_rule_cited,
      registration_refs: payload.registration_refs,
      evidence_links: payload.evidence_links,
      requirements: payload.requirements,
      responsible_actor: payload.responsible_actor,
      evaluation_binding: payload.evaluation_binding,
      evaluation_pins: payload.evaluation_pins,
      authorization_granted: false,
      execution_performed: false,
      uncertainty_flags: payload.uncertainty_flags ?? [],
    });
    if (!finalEnvelopeWithinBudget(result)) {
      return baseDenial(task, "REFUSED", "OUTPUT_LIMIT", "error", `final output envelope exceeds ${BUDGET_LIMITS.maxOutputBytes} bytes`);
    }
    return result;
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message);
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", e.message);
    throw e;
  }
}

export { validateTask, validateContext, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
export { evaluate } from "./evaluate.js";
export { reevaluate } from "./simulator.js";
export { renderAuditPreview } from "./markdown.js";
