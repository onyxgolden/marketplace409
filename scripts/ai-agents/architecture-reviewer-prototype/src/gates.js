/**
 * gates.js — fixture gate simulator for the architecture-reviewer
 * prototype. SEPARATE from the advisory review path: it reports evidence
 * sufficiency only and performs no merge.
 *
 * Trust model (AR-001): the task payload supplies REFERENCES ONLY
 * (verdict_ref, agreement_ref) into the separately injected authenticated
 * fixture stores (context.verdicts, context.agreements, context.principals).
 * Request-minted verdict labels, agreement booleans and matching hashes are
 * never trusted. Every consulted store is budgeted BEFORE scanning, and
 * every record passes a strict runtime schema (required revoked boolean,
 * real calendar dates, no missing-field defaults).
 *
 * The gate accepts an authenticated designated-ChatGPT GO plus a Muse
 * agreement record, both bound to the same repo/resource/scope/source/
 * result head/current round, with validity/revocation and the standing
 * agreement checks. A newer-round verdict for the same target supersedes
 * an older GO (stale evidence). authorization_granted is always false:
 * advisory output is never an execution token.
 */

import { canonicalJson } from "./canonical.js";
import { BudgetError } from "./resolver.js";
import {
  SchemaError,
  validateReviewerVerdictRecord,
  validateAgreementRecord,
  validatePrincipalRecord,
  validateGatePolicy,
  validateRecordStore,
  validateIsoDate,
} from "./schemas.js";

export const DESIGNATED_REVIEWER = "chatgpt";
export const DESIGNATED_PRINCIPAL = "muse";

/**
 * Charged record lookup: every record consulted during the scan is
 * counted (object + its payload bytes) BEFORE it is used. AR-004: an
 * unbounded .find that counts only the hit is a bypass — the scan
 * itself is budgeted.
 */
function findRecord(records, match, budget) {
  for (const r of records) {
    budget.countObject();
    budget.countPayload(canonicalJson(r));
    if (match(r)) return r;
  }
  return undefined;
}

/** Charged predicate scan over records (for the supersession check). */
function scanRecords(records, visit, budget) {
  for (const r of records) {
    budget.countObject();
    budget.countPayload(canonicalJson(r));
    const stop = visit(r);
    if (stop) break;
  }
}
function chargeStore(context, name, budget, validator, where) {
  const raw = context && context[name];
  if (raw === undefined) return [];
  budget.countObject();
  budget.countPayload(canonicalJson(raw));
  return validateRecordStore(raw, validator, `context.${name}`);
}

/** Round ordering: "round-N" -> N; unparseable rounds are incomparable. */
function roundNumber(round) {
  const m = /^round-(\d+)$/.exec(String(round));
  return m ? Number(m[1]) : null;
}

function sameTarget(a, b) {
  if (a.repo !== b.repo || a.resource !== b.resource) return false;
  const sa = [...(a.scope_ids ?? [])].sort();
  const sb = [...(b.scope_ids ?? [])].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

function windowValidMs(validFrom, expiresAt, clock) {
  const from = validateIsoDate(validFrom, "validity.valid_from");
  const until = validateIsoDate(expiresAt, "validity.expires_at");
  return clock >= from && clock < until;
}

/**
 * Evaluate gate evidence. Returns the agent payload (without the common
 * envelope). Schema failures in the injected stores are treated as gate
 * insufficiency with an explicit reason — a malformed trust store can
 * never authenticate a gate.
 */
export function evaluateGate(task, context, budget) {
  const ge = task.gate_evidence;
  const clock = context && context.clock;
  const checks = [];

  const record = (name, ok, detail) => {
    checks.push({ name, sufficient: ok, detail });
    return ok;
  };

  // AR-001/AR-004: the host gate policy is the independently current
  // target binding (exact current head + source identity). It is
  // validated AND charged before anything consults it. A malformed
  // policy is gate insufficiency; budget exhaustion is an interrupted
  // evaluation and is rethrown to the public handler, never converted
  // into an ordinary complete review.
  let policy;
  try {
    const rawPolicy = (context && context.gatePolicy) || {};
    budget.countObject();
    budget.countPayload(canonicalJson(rawPolicy), "gate policy");
    policy = validateGatePolicy(rawPolicy, "context.gatePolicy");
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    const reason = e instanceof SchemaError ? e.message : String((e && e.message) || e);
    record("gate-policy", false, `host gate policy failed strict validation: ${reason}`);
    return gateResult(task, checks, false, null, null);
  }

  let verdicts, agreements, principals;
  try {
    verdicts = chargeStore(context, "verdicts", budget, validateReviewerVerdictRecord, "verdicts");
    agreements = chargeStore(context, "agreements", budget, validateAgreementRecord, "agreements");
    principals = chargeStore(context, "principals", budget, validatePrincipalRecord, "principals");
  } catch (e) {
    // AR-004: budget exhaustion is an interrupted evaluation, not
    // insufficiency. Rethrow so the public handler returns the named
    // INPUT_LIMIT/BUDGET_EXCEEDED envelope with complete:false.
    // Malformed trust records stay ordinary insufficiency (complete:true).
    if (e instanceof BudgetError) throw e;
    const reason = e instanceof SchemaError ? e.message : String((e && e.message) || e);
    record("trust-store", false, `injected trust store failed strict validation: ${reason}`);
    return gateResult(task, checks, false, null, null);
  }

  // 1. The referenced verdict record must exist in the injected store.
  //    A forged valid-hash record that was never registered resolves to
  //    nothing here — hash equality is not registration.
  const verdict = findRecord(verdicts, (r) => r.record_id === ge.verdict_ref, budget);
  const verdictOk = record(
    "verdict-record",
    verdict !== undefined,
    verdict !== undefined
      ? `verdict reference '${ge.verdict_ref}' resolved in the injected verdict store`
      : `verdict reference '${ge.verdict_ref}' not found in the injected verdict store; request-minted labels are not trusted`
  );
  if (!verdictOk) return gateResult(task, checks, false, null, null);

  // 2. Designated reviewer only — never self-issued, never advisory.
  record(
    "designated-reviewer",
    verdict.reviewer === DESIGNATED_REVIEWER,
    verdict.reviewer === DESIGNATED_REVIEWER
      ? "verdict reviewer is the designated ChatGPT reviewer"
      : `verdict reviewer '${verdict.reviewer}' is not the designated reviewer; self-issued evidence rejected`
  );
  record(
    "advisory-rejected",
    verdict.advisory === false,
    verdict.advisory === false
      ? "verdict is a binding review record, not advisory output"
      : "advisory verdict records cannot gate; only binding review records qualify"
  );

  // 3. Only a GO verdict can gate.
  record(
    "verdict-go",
    verdict.verdict === "GO",
    verdict.verdict === "GO" ? "verdict is GO" : `verdict '${verdict.verdict}' is not GO and cannot gate`
  );

  // 4. Round must be the policy's current round, and no newer-round
  //    verdict for the same target may exist — a newer round supersedes
  //    an older GO (stale evidence).
  const roundCurrent = verdict.round === policy.required_round;
  record(
    "round-current",
    roundCurrent,
    roundCurrent
      ? `verdict round '${verdict.round}' matches the required round`
      : `verdict round '${verdict.round}' does not match required round '${policy.required_round}'`
  );
  let staleDetail = "no newer-round verdict for this target in the store";
  let notStale = true;
  if (roundCurrent) {
    const rn = roundNumber(verdict.round);
    scanRecords(
      verdicts,
      (other) => {
        if (other.record_id === verdict.record_id) return false;
        if (!sameTarget(other, verdict)) return false;
        const on = roundNumber(other.round);
        if (rn !== null && on !== null && on > rn) {
          notStale = false;
          staleDetail = `newer-round verdict '${other.record_id}' (round '${other.round}', ${other.verdict}) supersedes round '${verdict.round}' GO`;
          return true;
        }
        return false;
      },
      budget
    );
  }
  record("not-superseded", notStale, staleDetail);

  // 5. Result head must equal the reviewed head — a GO dies with its head.
  record(
    "head-match",
    verdict.result_head === verdict.reviewed_head,
    verdict.result_head === verdict.reviewed_head
      ? "result head equals the reviewed head"
      : "result head does not match the reviewed head"
  );

  // 6. Repo/resource/scope must name the same target as the policy.
  const targetOk = sameTarget(verdict, policy);
  record(
    "target-match",
    targetOk,
    targetOk ? "repo/resource/scope match the gated target" : "repo/resource/scope do not match the gated target"
  );

  // 7. AR-001: the verdict's source must match the policy's source
  //    identity. source_ref is required by schema; a verdict whose
  //    source names another repo is evidence for another target.
  const sourceOk = verdict.source_ref.repo === policy.source.repo;
  record(
    "source-match",
    sourceOk,
    sourceOk
      ? `verdict source repo '${verdict.source_ref.repo}' matches the policy source identity`
      : `verdict source repo '${verdict.source_ref.repo}' does not match the policy source identity '${policy.source.repo}'`
  );

  // 8. AR-001: the verdict's heads must equal the POLICY's current
  //    head — the independently current target — not merely match each
  //    other. Internally consistent stale heads are rejected.
  const currentHeadOk = verdict.result_head === policy.result_head && verdict.reviewed_head === policy.result_head;
  record(
    "current-head",
    currentHeadOk,
    currentHeadOk
      ? "verdict result/reviewed heads equal the policy's current target head"
      : "verdict heads do not equal the policy's current target head; stale or foreign heads rejected"
  );

  // 7. Validity window and revocation on the verdict record.
  let verdictValid = false;
  let verdictValidDetail = "verdict validity window check";
  try {
    const from = validateIsoDate(verdict.valid_from, "verdict.valid_from");
    const until = validateIsoDate(verdict.expires_at, "verdict.expires_at");
    if (verdict.revoked === true) {
      verdictValidDetail = "verdict record is revoked";
    } else if (!Number.isFinite(clock) || clock < from || clock >= until) {
      verdictValidDetail = "verdict record is not valid at the task clock";
    } else {
      verdictValid = true;
      verdictValidDetail = "verdict record is unrevoked and valid at the task clock";
    }
  } catch (e) {
    verdictValidDetail = `verdict validity dates invalid: ${e.message}`;
  }
  record("verdict-validity", verdictValid, verdictValidDetail);

  // 8. The referenced agreement record must exist and be an explicit
  //    agreement — mere principal registration is not agreement.
  const agreement = findRecord(agreements, (r) => r.record_id === ge.agreement_ref, budget);
  const agreementOk = record(
    "agreement-record",
    agreement !== undefined && agreement.agreed === true,
    agreement === undefined
      ? `agreement reference '${ge.agreement_ref}' not found in the injected agreement store; registration alone is not agreement`
      : agreement.agreed !== true
        ? `agreement record '${ge.agreement_ref}' does not record agreement`
        : `agreement record '${ge.agreement_ref}' records explicit agreement`
  );

  let agreementBindOk = false;
  let principalOk = false;
  if (agreementOk) {
    // 10. AR-001: the agreement must reference the EXACT gated verdict
    //     record. Agreement is with this verdict — a validated reference
    //     to it — not a generic agreed:true that could attach to any
    //     verdict in the store.
    const boundVerdict = findRecord(verdicts, (r) => r.record_id === agreement.verdict_ref, budget);
    const verdictBindOk =
      boundVerdict !== undefined && boundVerdict.record_id === verdict.record_id;
    record(
      "agreement-verdict-bind",
      verdictBindOk,
      verdictBindOk
        ? `agreement references the exact gated verdict record '${verdict.record_id}'`
        : `agreement verdict_ref '${agreement.verdict_ref}' does not resolve to the gated verdict record '${verdict.record_id}'`
    );

    // 11. AR-001: the agreement must bind the independently current
    //     target from the host policy — same source, same current head,
    //     same current round — not merely the verdict's own fields.
    //     A target change voids the agreement.
    const agreementSourceOk = agreement.source_ref.repo === policy.source.repo;
    record(
      "agreement-source-match",
      agreementSourceOk,
      agreementSourceOk
        ? `agreement source repo '${agreement.source_ref.repo}' matches the policy source identity`
        : `agreement source repo '${agreement.source_ref.repo}' does not match the policy source identity '${policy.source.repo}'`
    );
    const agreementHeadOk = agreement.result_head === policy.result_head;
    record(
      "agreement-current-head",
      agreementHeadOk,
      agreementHeadOk
        ? "agreement result head equals the policy's current target head"
        : "agreement result head does not equal the policy's current target head"
    );
    const agreementRoundOk = agreement.round === policy.required_round;
    record(
      "agreement-round-current",
      agreementRoundOk,
      agreementRoundOk
        ? `agreement round '${agreement.round}' matches the required round`
        : `agreement round '${agreement.round}' does not match required round '${policy.required_round}'`
    );

    // 12. The agreement must bind the SAME target as the verdict record:
    //     repo/resource/scope/result head/round. A target change voids it.
    agreementBindOk =
      agreement.repo === verdict.repo &&
      agreement.resource === verdict.resource &&
      sameTarget(agreement, verdict) &&
      agreement.result_head === verdict.result_head &&
      agreement.round === verdict.round;
    record(
      "agreement-target-bind",
      agreementBindOk,
      agreementBindOk
        ? "agreement binds the same repo/resource/scope/result head/round as the verdict record"
        : "agreement target does not match the verdict record target"
    );
    // 13. Agreement validity window and revocation.
    let agreementValid = false;
    try {
      const from = validateIsoDate(agreement.valid_from, "agreement.valid_from");
      const until = validateIsoDate(agreement.expires_at, "agreement.expires_at");
      agreementValid = agreement.revoked !== true && Number.isFinite(clock) && clock >= from && clock < until;
    } catch {
      agreementValid = false;
    }
    record(
      "agreement-validity",
      agreementValid,
      agreementValid ? "agreement record is unrevoked and valid at the task clock" : "agreement record is revoked, expired or invalid"
    );

    // 14. The agreement's principal must be the Jason-registered Muse
    //     principal: registered by jason, unrevoked, valid at the clock.
    //     This preserves the existing Jason/Muse channel; it adds no new
    //     Jason approval gate.
    const principal = findRecord(principals, (p) => p.principal_id === agreement.principal_id, budget);
    if (principal === undefined) {
      record("muse-principal", false, `agreement principal '${agreement.principal_id}' not found in the principal registry`);
    } else if (principal.principal_id !== DESIGNATED_PRINCIPAL) {
      record("muse-principal", false, `agreement principal '${principal.principal_id}' is not the designated Muse principal`);
    } else if (principal.registered_by !== "jason") {
      record("muse-principal", false, "Muse principal is not Jason-registered");
    } else if (principal.revoked === true) {
      record("muse-principal", false, "Muse principal is revoked");
    } else {
      try {
        principalOk = windowValidMs(principal.valid_from, principal.expires_at, clock);
        record(
          "muse-principal",
          principalOk,
          principalOk ? "Muse agreement authenticated via the Jason-registered principal" : "Muse principal is not valid at the task clock"
        );
      } catch (e) {
        record("muse-principal", false, `Muse principal dates invalid: ${e.message}`);
      }
    }
  }

  const sufficient = checks.every((c) => c.sufficient);
  return gateResult(task, checks, sufficient, verdict, agreementOk && principalOk);
}

function gateResult(task, checks, sufficient, verdict, agreementAuthenticated) {
  return {
    status: "REVIEWED",
    gate: {
      sufficient,
      checks,
      evidence: verdict
        ? {
            reviewer: verdict.reviewer,
            round: verdict.round,
            verdict: verdict.verdict,
            result_head: verdict.result_head,
            record_id: verdict.record_id,
            agreement_authenticated: agreementAuthenticated,
          }
        : { record_id: null, agreement_authenticated: false },
    },
    verdict_proposal: null,
    authorization_granted: false,
    complete: true,
  };
}
