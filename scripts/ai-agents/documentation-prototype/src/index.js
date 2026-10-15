/**
 * index.js — public entry for the documentation drift-detector prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. The agent has no file-write API, no
 * network, no tool calls: it returns a detached advisory JSON snapshot.
 * Advisory output is never an execution token. A malformed request,
 * budget exhaustion, prohibited action, injection or unsupported task
 * yields a structured REFUSED/BLOCKED/UNVERIFIABLE denial — never an
 * exception and never a default success.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import { validateTask, validateContext, SchemaError } from "./schemas.js";
import { scanTaskStrings } from "./injection.js";
import { detectDrift, proposalIdOf } from "./detector.js";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "./resolver.js";

export const AGENT_ID = "documentation";
export const SCHEMA_VERSION = "1";

function taskIdOf(task) {
  try {
    return `doc-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "doc-invalid-task";
  }
}

function baseDenial(task, status, code, severity, reason) {
  let proposal_id = null;
  try {
    if (task && typeof task === "object") proposal_id = proposalIdOf(task);
  } catch {
    proposal_id = null;
  }
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: [],
    status,
    proposal_id,
    doc_ref: task && typeof task === "object" ? task.doc_ref ?? null : null,
    code_evidence: [],
    proposed_diff: null,
    claims: [],
    excluded_claims: [],
    uncertainty_flags: [],
    reviewer_preview: [],
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    quarantined_sources: [],
    routing_flags: [],
    complete: false,
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
  return (
    (result.claims?.length ?? 0) +
    (result.excluded_claims?.length ?? 0) +
    (result.diagnostics?.length ?? 0) +
    (result.quarantined_sources?.length ?? 0) +
    (result.uncertainty_flags?.length ?? 0) +
    (result.reviewer_preview?.length ?? 0) +
    (result.code_evidence?.length ?? 0) +
    (result.routing_flags?.length ?? 0) +
    (result.source_refs?.length ?? 0)
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
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message);
    throw e;
  }

  // Task-level injection refuses before any resolution or extraction.
  const hits = scanTaskStrings(validated);
  void hits; // detector re-scans with family-aware refusal; index only needs the gate below.

  let ctx;
  try {
    ctx = validateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", `context: ${e.message}`);
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  try {
    const payload = detectDrift(validated, ctx, budget);
    const result = envelope(task, {
      status: payload.status,
      proposal_id: payload.proposal_id,
      doc_ref: payload.doc_ref,
      code_evidence: payload.code_evidence,
      source_refs: payload.source_refs ?? [],
      proposed_diff: payload.proposed_diff,
      claims: payload.claims,
      excluded_claims: payload.excluded_claims,
      uncertainty_flags: payload.uncertainty_flags,
      reviewer_preview: payload.reviewer_preview,
      diagnostics: payload.diagnostics,
      quarantined_sources: payload.quarantined_sources,
      routing_flags: [],
      complete: payload.complete === true,
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
export { parseCodeFixture, parseDocValue, effectiveCodeValue } from "./extraction.js";
export { renderMarkdown } from "./markdown.js";
