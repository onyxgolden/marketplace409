/**
 * index.js — public entry for the Tax Agent educational-draft prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. A deterministic educational-topic
 * classifier and cited draft assembler — NOT a tax calculator, NOT a
 * general-purpose chatbot. The agent has no file-write API, no network,
 * no tool calls: it returns a detached advisory JSON snapshot. Personal
 * financial facts or advice requests force REFUSED/PERSONALIZED_INPUT
 * with zero draft content and a licensed-professional referral, even
 * under a disclaimer, a general-looking topic, or a claimed expert
 * approval — before any other check, before any source is consulted.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import { validateTask, validateContext, SchemaError, REQUESTED_ACTION_ALLOWED } from "./schemas.js";
import { scanInputText } from "./injection.js";
import { scanAnyPersonalFacts } from "./personal.js";
import { makeBudget, BudgetError, BUDGET_LIMITS } from "./resolver.js";
import { findRegistryEntry, assembleDraft, reviewRequiredUnknownTopic } from "./registry.js";

export const AGENT_ID = "tax-agent";
export const SCHEMA_VERSION = "1";

function taskIdOf(task) {
  try {
    return `tax-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "tax-invalid-task";
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
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    quarantined_sources: [],
    routing_flags: [],
    complete: false,
    status,
    explanation: null,
    claims: [],
    citations: [],
    registry_match: null,
    educational_only: true,
    publication_authorized: false,
    published: false,
    expert_review_required: status === "REVIEW_REQUIRED" || status === "BLOCKED",
    advice_flags: status === "REFUSED" && code === "PERSONALIZED_INPUT" ? [{ trigger: "PERSONALIZED_INPUT", action: "REFERRED_TO_LICENSED_PROFESSIONAL" }] : [],
    referral: code === "PERSONALIZED_INPUT" ? { required: true, target_role: "LICENSED_TAX_PROFESSIONAL", reason_code: "PERSONAL_ADVICE_REQUEST" } : null,
    applicability_summary: null,
    historical: false,
    uncertainty_flags: [code],
  };
}

/** Stable key for deduping SourceRefs by exact identity. */
function refKey(r) {
  return `${r.repo}|${r.path}|${r.commit}|${r.blob}`;
}

/**
 * Deterministic provenance list for the common envelope: the verified
 * registry SourceRef (only present once chain authentication actually
 * succeeded) plus every verified supporting claim's SourceRef from the
 * outcome's own citations — never a quarantined or denied source, since
 * those never reach `citations`/`_registry_source_ref` in the first place.
 * Order: registry ref first (if present), then citations in their
 * existing deterministic order; de-duplicated by exact identity.
 */
function sourceRefsOf(outcome) {
  const refs = [];
  const seen = new Set();
  const add = (r) => {
    if (!r) return;
    const k = refKey(r);
    if (seen.has(k)) return;
    seen.add(k);
    refs.push({ repo: r.repo, path: r.path, commit: r.commit, blob: r.blob, algorithm: r.algorithm, revision: r.revision });
  };
  add(outcome._registry_source_ref);
  for (const c of outcome.citations ?? []) add(c);
  return refs;
}

function envelope(task, outcome, extraDiagnostics = [], extraQuarantine = []) {
  const diagnostics = [...extraDiagnostics, ...(outcome._diagnostics ?? [])];
  const quarantined_sources = [...extraQuarantine, ...(outcome._quarantined ?? [])];
  const advice_flags = [...outcome.advice_flags];
  let referral = outcome.referral;
  if (diagnostics.some((d) => d.code === "PERSONALIZED_INPUT")) {
    if (!advice_flags.some((f) => f.trigger === "PERSONALIZED_INPUT")) {
      advice_flags.push({ trigger: "PERSONALIZED_INPUT", action: "REFERRED_TO_LICENSED_PROFESSIONAL" });
    }
    referral = { required: true, target_role: "LICENSED_TAX_PROFESSIONAL", reason_code: "PERSONAL_ADVICE_REQUEST" };
  }
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    advisory: true,
    fixture_only: true,
    source_refs: sourceRefsOf(outcome),
    diagnostics,
    quarantined_sources,
    routing_flags: [],
    complete: outcome._complete === true,
    status: outcome.status,
    explanation: outcome.explanation,
    claims: outcome.claims.map((c) => ({ claim_id: c.claim_id, concept_key: c.concept_key, text: c.text, citation_ids: c.citation_ids })),
    citations: outcome.citations,
    registry_match: outcome.registry_match,
    educational_only: outcome.educational_only,
    publication_authorized: outcome.publication_authorized,
    published: outcome.published,
    expert_review_required: outcome.expert_review_required,
    advice_flags,
    referral,
    applicability_summary: outcome.applicability_summary,
    historical: outcome.historical,
    uncertainty_flags: outcome.uncertainty_flags,
  };
}

function outputRecords(result) {
  return (
    (result.claims?.length ?? 0) +
    (result.citations?.length ?? 0) +
    (result.diagnostics?.length ?? 0) +
    (result.quarantined_sources?.length ?? 0) +
    (result.advice_flags?.length ?? 0) +
    (result.uncertainty_flags?.length ?? 0) +
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

  if (validated.kind === "prohibited") {
    return baseDenial(
      task,
      "REFUSED",
      "ACTION_DENIED",
      "critical",
      `prohibited action '${validated.requested_action}': this agent drafts general educational content only (${REQUESTED_ACTION_ALLOWED}); it cannot prepare/file documents, update law packs, approve content, publish, or personalize advice`
    );
  }

  // Personal-fact scan runs before anything else is consulted: personal
  // facts never yield content even if another failure is also present.
  const personal = scanAnyPersonalFacts([validated.task_id, validated.topic_label]);
  if (personal.personal) {
    return baseDenial(task, "REFUSED", "PERSONALIZED_INPUT", "critical", "input contains personal-financial-fact or personalized-advice-request content; refused with professional referral, no draft");
  }

  const taskIdInjection = scanInputText(validated.task_id);
  const topicLabelInjection = scanInputText(validated.topic_label);
  if (taskIdInjection.injected || topicLabelInjection.injected) {
    return baseDenial(task, "REFUSED", "INSTRUCTION_INJECTION", "critical", "input contains seeded directive content; refused, no registry lookup performed");
  }

  let ctx;
  try {
    ctx = validateContext(context, budget);
  } catch (e) {
    if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", `context: ${e.message}`);
    if (e instanceof SchemaError) return baseDenial(task, "REFUSED", "INVALID_INPUT", "error", `context: ${e.message}`);
    throw e;
  }

  // Bounded optional extra source_refs: resolved and scanned, but never
  // fed into claims (never content/keys/approval records supplied inline).
  const extraDiagnostics = [];
  const extraQuarantine = [];
  for (const ref of validated.source_refs) {
    if (!ctx.readGrants.some((g) => g.repo === ref.repo && g.path === ref.path)) {
      extraDiagnostics.push({ code: "READ_DENIED", severity: "error", source_ref: ref, record_id: null, reason: `read grant missing for ${ref.repo}/${ref.path}` });
      continue;
    }
    const entrySrc = ctx.sources[`${ref.repo}|${ref.path}`];
    const rev = entrySrc && entrySrc.revisions && entrySrc.revisions[ref.commit];
    if (!rev || typeof rev.text !== "string") {
      extraDiagnostics.push({ code: "SOURCE_UNVERIFIED", severity: "error", source_ref: ref, record_id: null, reason: `source ${ref.repo}/${ref.path}@${ref.commit.slice(0, 8)} not registered` });
      continue;
    }
    try {
      budget.countObject();
      budget.countPayload(rev.text, `extra source ${ref.repo}/${ref.path}`);
    } catch (e) {
      if (e instanceof BudgetError) return baseDenial(task, "REFUSED", e.code, "error", e.message);
      throw e;
    }
    const sText = rev.text;
    const sInj = scanInputText(sText);
    const sPersonal = scanAnyPersonalFacts([sText]);
    if (sInj.injected || sPersonal.personal) {
      extraQuarantine.push({ repo: ref.repo, path: ref.path });
      extraDiagnostics.push(
        sInj.injected
          ? { code: "INSTRUCTION_INJECTION", severity: "critical", source_ref: ref, record_id: null, reason: `requested extra source ${ref.repo}/${ref.path} contains a seeded directive family; quarantined` }
          : { code: "PERSONALIZED_INPUT", severity: "critical", source_ref: ref, record_id: null, reason: `requested extra source ${ref.repo}/${ref.path} contains personal-fact-looking content; quarantined` }
      );
    }
  }
  if (extraQuarantine.length > 0) {
    const denial = baseDenial(task, "REFUSED", "INSTRUCTION_INJECTION", "critical", "a requested extra source is quarantined; whole draft blocked, avoiding partial unsafe explanations");
    denial.diagnostics = extraDiagnostics;
    denial.quarantined_sources = extraQuarantine;
    denial.uncertainty_flags = [...new Set(extraDiagnostics.map((d) => d.code))];
    if (extraDiagnostics.some((d) => d.code === "PERSONALIZED_INPUT")) {
      denial.advice_flags = [{ trigger: "PERSONALIZED_INPUT", action: "REFERRED_TO_LICENSED_PROFESSIONAL" }];
      denial.referral = { required: true, target_role: "LICENSED_TAX_PROFESSIONAL", reason_code: "PERSONAL_ADVICE_REQUEST" };
    }
    return denial;
  }

  try {
    const entry = findRegistryEntry(ctx.registry, validated.topic_id);
    const outcome = entry ? assembleDraft({ task: validated, entry, ctx, budget, clock: ctx.clock }) : reviewRequiredUnknownTopic(validated);
    const result = envelope(task, outcome, extraDiagnostics, extraQuarantine);
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
