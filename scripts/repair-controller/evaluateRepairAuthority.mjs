// Deterministic, deny-by-default authority evaluator (FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md Section 6.H).
// Consumes a manifest, policy, and the evidence collected about a proposed repair; returns exactly one
// RepairDecision with stable, machine-readable reason codes. Never uses confidence/prose as authorization --
// every gate below is a structured field check.
//
// AR-1 scope boundary, enforced HERE, not just by omission: this evaluator can only ever return REJECT,
// DIAGNOSIS_COMPLETE, PREPARE_FOR_REVIEW, or ESCALATE. CREATE_PR, MERGE, DEPLOY, and ROLLBACK remain valid
// values in the RepairDecision contract for later phases (AR-4 automatic-PR, AR-6 integration, AR-7
// deployment), but this version's decision logic structurally never produces them -- there is no executor,
// Git-mutation, PR-creation, or deployment capability in AR-1 to act on a higher decision, and returning one
// anyway would be a false promise, not a safety feature. See AUTHORITY_CEILING_THIS_VERSION below.

import { validateRepairDecision, computeManifestHash, AUTHORITY_DECISION } from "./repairContracts.mjs";
import { classifyProtectedPaths, classifyTestIntegritySignals } from "./protectedOperationClassifier.mjs";

// Hard version cap, independent of any policy file's own maxLevel. Section 3: "Do not enable Levels 3 or 4
// during the initial implementation." A policy claiming a higher ceiling for some repair class does not
// override this -- the evaluator itself refuses to grant more.
export const AUTHORITY_CEILING_THIS_VERSION = 2;

function decision(repairId, policyVersion, outcome, reasonCodes, now) {
  return validateRepairDecision({ repairId, policyVersion, decision: outcome, reasonCodes, evaluatedAt: now });
}

// Effective authority is the minimum of every independent cap -- never the maximum, and never anything the
// manifest itself claims without cross-checking policy/approval. This is what makes "policy cannot promote
// itself" and "approval is bound to manifest hash and expires" actually load-bearing rather than advisory.
function resolveEffectiveCeiling({ manifest, policy, repairClassPolicy, approval, now }) {
  const caps = [manifest.effectiveAuthority, AUTHORITY_CEILING_THIS_VERSION];
  const reasonCodes = [];

  if (!repairClassPolicy) {
    caps.push(policy.defaultLevel);
    reasonCodes.push("unknown_repair_class_defaults_to_diagnose");
  } else {
    caps.push(repairClassPolicy.maxLevel);
    if (repairClassPolicy.requiresOwnerApproval) {
      const validApproval = approval
        && approval.manifestHash === computeManifestHash(manifest)
        && approval.baseSha === manifest.baseSha
        && approval.expiresAt > now;
      if (!validApproval) {
        caps.push(policy.defaultLevel);
        reasonCodes.push(approval ? "approval_invalid_or_expired_for_this_manifest" : "owner_approval_required_but_missing");
      } else {
        caps.push(approval.maxAuthority);
      }
    }
  }

  return { ceiling: Math.min(...caps), reasonCodes };
}

export function evaluateRepairAuthority({
  manifest, policy, changedPaths = [], actualDiffStats = null, testIntegritySignals = {},
  validationResults = {}, approval = null, circuitBreakerState = { attemptsForIncident: 0, openRepairs: 0 }, now,
}) {
  if (!policy) {
    // "Missing policy defaults to no mutation" -- not diagnose-only, REJECT outright, since without a
    // policy there is no basis for even the default level.
    return decision(manifest.repairId, "none", AUTHORITY_DECISION.REJECT, ["missing_policy_no_mutation"], now);
  }

  const repairClassPolicy = policy.repairClasses[manifest.repairClass] || null;

  // Protected domains always escalate, unconditionally, before any other gate is even consulted --
  // Section 4: "The controller must always require explicit owner approval... regardless of confidence."
  const pathClassifications = classifyProtectedPaths(changedPaths.length > 0 ? changedPaths : manifest.allowedPaths);
  const protectedPaths = pathClassifications.filter((c) => c.protected);
  if (protectedPaths.length > 0) {
    const reasons = new Set(["protected_domain_touched"]);
    protectedPaths.forEach((p) => p.reasons.forEach((r) => reasons.add(r)));
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.ESCALATE, [...reasons], now);
  }

  if (manifest.protectedDomainFlags.length > 0) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.ESCALATE,
      ["manifest_self_flagged_protected_domain", ...manifest.protectedDomainFlags], now);
  }

  const testIntegrity = classifyTestIntegritySignals(testIntegritySignals);
  if (testIntegrity.protected) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.ESCALATE, testIntegrity.reasons, now);
  }

  if (actualDiffStats) {
    const overBudget = [];
    if (actualDiffStats.filesChanged > manifest.maxFilesChanged) overBudget.push("files_changed_budget_exceeded");
    if (actualDiffStats.linesAdded > manifest.maxLinesAdded) overBudget.push("lines_added_budget_exceeded");
    if (actualDiffStats.linesDeleted > manifest.maxLinesDeleted) overBudget.push("lines_deleted_budget_exceeded");
    if (overBudget.length > 0) {
      return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.ESCALATE, overBudget, now);
    }
  }

  if (circuitBreakerState.attemptsForIncident >= policy.circuitBreaker.maximumAttemptsPerIncident) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.ESCALATE, ["circuit_breaker_max_attempts_tripped"], now);
  }
  if (circuitBreakerState.openRepairs >= policy.circuitBreaker.maximumOpenRepairs) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.ESCALATE, ["circuit_breaker_max_open_repairs_tripped"], now);
  }

  const { ceiling, reasonCodes: ceilingReasonCodes } = resolveEffectiveCeiling({ manifest, policy, repairClassPolicy, approval, now });

  if (ceiling <= 0) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.REJECT, ["authority_ceiling_zero"], now);
  }

  // Ambiguous/incomplete validation state (a required field simply never supplied, distinct from an
  // explicit failure) escalates rather than being treated as passing -- "never invent an answer."
  const requiredFields = ["buildPassed", "focusedPassed", "newFailuresBeyondBaseline"];
  const missingValidationFields = requiredFields.filter((field) => validationResults[field] === undefined);
  if (missingValidationFields.length > 0) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.ESCALATE,
      ["ambiguous_validation_state", ...missingValidationFields.map((f) => `missing_${f}`)], now);
  }

  // A successful focused test run can never override a failed production build -- checked first and
  // independently, so a broken build is never masked by an unrelated focused-test pass.
  if (validationResults.buildPassed === false) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.DIAGNOSIS_COMPLETE, ["build_failed"], now);
  }
  if (validationResults.focusedPassed === false) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.DIAGNOSIS_COMPLETE, ["focused_validation_failed"], now);
  }
  if (validationResults.newFailuresBeyondBaseline > 0) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.DIAGNOSIS_COMPLETE,
      ["new_failures_beyond_baseline"], now);
  }
  if (validationResults.broadPassed === false) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.DIAGNOSIS_COMPLETE, ["broad_validation_failed"], now);
  }

  if (ceiling === 1) {
    return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.DIAGNOSIS_COMPLETE,
      ["authority_ceiling_diagnose_only", ...ceilingReasonCodes], now);
  }

  // ceiling >= 2 (AUTHORITY_CEILING_THIS_VERSION caps it at exactly 2 -- never higher, see module header).
  return decision(manifest.repairId, policy.policyVersion, AUTHORITY_DECISION.PREPARE_FOR_REVIEW,
    ["validation_passed_prepared_for_review", ...ceilingReasonCodes], now);
}
