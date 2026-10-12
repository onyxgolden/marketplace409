/**
 * gates.js — fixture gate simulator for the architecture-reviewer
 * prototype. SEPARATE from the advisory review path: it reports evidence
 * sufficiency only and performs no merge.
 *
 * Accepts an authenticated designated-ChatGPT GO plus Muse agreement for
 * the same repo/resource/scope/result head and all standing checks.
 * Rejects advisory, self-issued, wrong-round, wrong-head and wrong-source
 * evidence. authorization_granted is always false: advisory output is
 * never an execution token.
 */

export const DESIGNATED_REVIEWER = "chatgpt";

/**
 * Evaluate gate evidence. context.principals is the separately injected
 * fixture principal registry; context.gatePolicy carries required_round.
 * Every consulted record is counted through the budget.
 */
export function evaluateGate(task, context, budget) {
  const ge = task.gate_evidence;
  const policy = (context && context.gatePolicy) || {};
  const checks = [];

  const record = (name, ok, detail) => {
    checks.push({ name, sufficient: ok, detail });
    return ok;
  };

  // 1. Designated reviewer only — never self-issued, never "advisory",
  //    never this agent's own identity.
  record(
    "designated-reviewer",
    ge.reviewer === DESIGNATED_REVIEWER,
    ge.reviewer === DESIGNATED_REVIEWER
      ? "reviewer is the designated ChatGPT reviewer"
      : `reviewer '${ge.reviewer}' is not the designated reviewer; advisory/self-issued evidence rejected`
  );

  // 2. Round must match the required round — a wrong round is stale.
  record(
    "round",
    ge.round === policy.required_round,
    ge.round === policy.required_round
      ? `round '${ge.round}' matches required round`
      : `round '${ge.round}' does not match required round '${policy.required_round}'`
  );

  // 3. Only a GO verdict can gate; NEEDS CHANGES/NO-GO is insufficient.
  record(
    "verdict-go",
    ge.verdict === "GO",
    ge.verdict === "GO" ? "verdict is GO" : `verdict '${ge.verdict}' is not GO and cannot gate`
  );

  // 4. Result head must equal the reviewed head — a GO dies with its head.
  const reviewedHead = ge.reviewed_head;
  record(
    "head-match",
    reviewedHead !== undefined && ge.result_head === reviewedHead,
    reviewedHead !== undefined && ge.result_head === reviewedHead
      ? "result head equals the reviewed head"
      : "result head does not match the reviewed head"
  );

  // 5. Repo/resource/scope must name the same target.
  const targetOk =
    ge.repo === policy.repo && ge.resource === policy.resource && sameScope(ge.scope_ids ?? [], policy.scope_ids ?? []);
  record(
    "target-match",
    targetOk,
    targetOk ? "repo/resource/scope match the gated target" : "repo/resource/scope do not match the gated target"
  );

  // 6. Muse agreement must authenticate against the injected principal
  //    registry: registered by jason, unrevoked, valid at the clock.
  let museOk = false;
  let museDetail = "muse_agreed is false";
  if (ge.muse_agreed === true) {
    const rec = findPrincipal(context, ge.muse_record_id);
    budget.countObject();
    if (!rec) {
      museDetail = `muse_record_id '${ge.muse_record_id}' not found in the principal registry`;
    } else if (rec.registered_by !== "jason") {
      museDetail = "muse record is not Jason-registered";
    } else if (rec.revoked === true) {
      museDetail = "muse record is revoked";
    } else if (!windowValid(rec, context.clock)) {
      museDetail = "muse record is not valid at the task clock";
    } else {
      museOk = true;
      museDetail = "Muse agreement authenticated via the Jason-registered principal";
    }
  }
  record("muse-agreement", museOk, museDetail);

  const sufficient = checks.every((c) => c.sufficient);
  return {
    status: "REVIEWED",
    gate: {
      sufficient,
      checks,
      evidence: {
        reviewer: ge.reviewer,
        round: ge.round,
        verdict: ge.verdict,
        result_head: ge.result_head,
      },
    },
    verdict_proposal: null,
    authorization_granted: false,
    complete: true,
  };
}

function sameScope(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function findPrincipal(context, recordId) {
  const principals = (context && context.principals) || [];
  return principals.find((p) => p && p.principal_id === recordId && p.principal_id === "muse");
}

function windowValid(rec, clock) {
  const from = Date.parse(rec.valid_from);
  const until = Date.parse(rec.expires_at);
  return Number.isFinite(from) && Number.isFinite(until) && clock >= from && clock < until;
}
