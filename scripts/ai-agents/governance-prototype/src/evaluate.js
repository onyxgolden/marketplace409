/**
 * evaluate.js — deterministic policy-applicability evaluation.
 *
 * Decision order (governance brief):
 *  1. Invalid/prohibited agent operation -> REFUSED, UNGROUNDED, DENIED.
 *  2. Missing/unverifiable/inapplicable authority or target/evidence
 *     conflict -> CLASSIFIED, UNGROUNDED, DENIED, complete:false.
 *  3. Verified explicit prohibition -> CLASSIFIED, GROUNDED, DENIED.
 *  4. Verified applicable rule with unmet approval/agreement requirements
 *     -> CLASSIFIED, GROUNDED, NEEDS-APPROVAL.
 *  5. All registered applicable conditions satisfied -> CLASSIFIED,
 *     GROUNDED, ALLOWED, authorization_granted:false.
 *
 * Advisory output is never an execution token. classification ALLOWED
 * grants nothing; authorization_granted and execution_performed are
 * always false.
 */

import { canonicalJson, sha256HexUtf8, sha256HexBytes } from "./canonical.js";
import { resolveSourceRef, verifyCitation } from "./resolver.js";
import { findDirectives } from "./injection.js";

export const DESIGNATED_REVIEWER = "principal:chatgpt";
export const AGREEMENT_AGENT = "principal:muse";
export const JASON = "principal:jason";
export const TRUSTED_ISSUER = "registry-host";

/** Freeze window 01:50–02:15 America/Chicago = 06:50–07:15 UTC (CDT, Oct). */
function inFreezeWindow(clockMs) {
  const d = new Date(clockMs);
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= 6 * 60 + 50 && mins < 7 * 60 + 15;
}

function diag(code, severity, reason, record_id = null, source_ref = null) {
  return { code, severity, source_ref, record_id, reason };
}

function sameScopeSet(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Canonical policy content bound by policy_sha256. */
export function policyContent(p) {
  return {
    policy_id: p.policy_id,
    version: p.version,
    action_ids: p.action_ids,
    resource_classes: p.resource_classes,
    scope_ids: p.scope_ids,
    rules: p.rules,
    steward_ref: p.steward_ref,
    supersedes: p.supersedes,
  };
}

export function verdictDigest(v) {
  return sha256HexUtf8({
    verdict_id: v.verdict_id,
    reviewer_ref: v.reviewer_ref,
    designated: v.designated,
    verdict: v.verdict,
    repo: v.repo,
    resource_id: v.resource_id,
    scope_ids: [...v.scope_ids].sort(),
    head: v.head,
  });
}

export function agreementDigest(a) {
  return sha256HexUtf8({
    agreement_id: a.agreement_id,
    agent_ref: a.agent_ref,
    verdict_ref: a.verdict_ref,
    head: a.head,
    head_match: a.head_match,
    no_conflict_markers: a.no_conflict_markers,
    safe_scope: a.safe_scope,
    sound_reasoning: a.sound_reasoning,
  });
}

export function relayDigest(r) {
  return sha256HexUtf8({
    relay_id: r.relay_id,
    origin_ref: r.origin_ref,
    relay_ref: r.relay_ref,
    issuer: r.issuer,
  });
}

function principalById(ctx, id) {
  return ctx.principals.find((p) => p.principal_id === id) ?? null;
}

/**
 * Resolve applicable policy registrations for the exact task target/action.
 * Returns {applicable:[{registration, policy}], errors:[diag]}.
 */
function applicableRegistrations(ctx, budget, task, diags) {
  const out = [];
  for (const reg of ctx.registrations) {
    budget.countObject(`registration ${reg.record_id}`);
    if (reg.issuer !== TRUSTED_ISSUER) {
      diags.push(diag("AUTH_UNVERIFIED", "error", `registration ${reg.record_id} issuer '${reg.issuer}' is not the trusted adapter`, reg.record_id));
      continue;
    }
    // Note: a self-issued record (issuer === task.actor_ref) never passes
    // the trusted-issuer gate above, so request self-registration fails here.
    if (reg.revoked) continue;
    if (!(reg.valid_from <= ctx.clock && ctx.clock < reg.expires_at)) continue;
    if (!reg.action_ids.includes(task.action_type)) continue;
    if (!task.target.scope_ids.every((s) => reg.scope_ids.includes(s))) continue;
    const policy = ctx.policies.find((p) => p.policy_id === reg.subject_ref && p.version === reg.policy_version);
    if (!policy) {
      diags.push(diag("AUTH_UNVERIFIED", "error", `registration ${reg.record_id} binds unknown policy ${reg.subject_ref}@${reg.policy_version}`, reg.record_id));
      continue;
    }
    if (!policy.resource_classes.includes(task.target.resource_class)) continue;
    if (!(policy.effective_from <= ctx.clock && ctx.clock < policy.effective_to)) continue;
    if (!principalById(ctx, policy.steward_ref)) {
      diags.push(diag("AUTH_UNVERIFIED", "error", `policy ${policy.policy_id} steward '${policy.steward_ref}' is not a registered principal`, reg.record_id));
      continue;
    }
    const recomputed = sha256HexUtf8(policyContent(policy));
    if (recomputed !== policy.policy_sha256 || recomputed !== reg.binding_sha256) {
      diags.push(diag("HASH_MISMATCH", "error", `policy content hash mismatch for ${policy.policy_id}@${policy.version}`, reg.record_id));
      continue;
    }
    const src = resolveSourceRef(ctx, budget, reg.source_ref);
    if (!src.ok) {
      diags.push(diag(src.code, "error", `registration ${reg.record_id}: ${src.reason}`, reg.record_id));
      continue;
    }
    out.push({ registration: reg, policy });
  }
  return out;
}

/**
 * Evaluate one gate requirement. Returns {state, evidence_refs, responsible}.
 */
function evaluateGate(ctx, budget, task, headEntry, gateId, found, diags) {
  if (gateId === "req:reviewer-go") {
    const v = found.verdict;
    if (!v) return { state: "outstanding", evidence_refs: [], responsible: DESIGNATED_REVIEWER };
    if (!v.designated || v.reviewer_ref !== DESIGNATED_REVIEWER) {
      return { state: "outstanding", evidence_refs: [v.verdict_id], responsible: DESIGNATED_REVIEWER };
    }
    return { state: "satisfied", evidence_refs: [v.verdict_id], responsible: null };
  }
  if (gateId === "req:muse-agreement") {
    const a = found.agreement;
    const v = found.verdict;
    const vid = v ? v.verdict_id : null;
    if (!a) return { state: "outstanding", evidence_refs: v ? [v.verdict_id] : [], responsible: AGREEMENT_AGENT };
    if (a.verdict_ref !== vid) {
      diags.push(diag("AUTH_UNVERIFIED", "critical", `agreement ${a.agreement_id} binds verdict '${a.verdict_ref}', not the evaluated verdict`, a.agreement_id));
      found.fatal = found.fatal ?? [];
      found.fatal.push("agreement-verdict-link");
      return { state: "outstanding", evidence_refs: [a.agreement_id], responsible: AGREEMENT_AGENT };
    }
    if (a.revoked || !(a.valid_from <= ctx.clock && ctx.clock < a.expires_at)) {
      return { state: "outstanding", evidence_refs: [a.agreement_id], responsible: AGREEMENT_AGENT };
    }
    if (!a.head_match || a.head !== headEntry.head) {
      return { state: "outstanding", evidence_refs: [a.agreement_id], responsible: AGREEMENT_AGENT };
    }
    if (!a.no_conflict_markers || !a.safe_scope || !a.sound_reasoning) {
      return { state: "outstanding", evidence_refs: [a.agreement_id], responsible: AGREEMENT_AGENT };
    }
    if (agreementDigest(a) !== a.digest) {
      diags.push(diag("HASH_MISMATCH", "error", `agreement ${a.agreement_id} digest mismatch`, a.agreement_id));
      return { state: "outstanding", evidence_refs: [a.agreement_id], responsible: AGREEMENT_AGENT };
    }
    return { state: "satisfied", evidence_refs: [a.agreement_id], responsible: null };
  }
  if (gateId === "req:jason-authorization") {
    if (task.actor_ref === JASON) return { state: "satisfied", evidence_refs: [JASON], responsible: null };
    const relay = ctx.relays.find((r) => r.origin_ref === JASON && r.relay_ref === task.actor_ref);
    if (!relay) return { state: "outstanding", evidence_refs: [], responsible: JASON };
    if (relay.issuer !== TRUSTED_ISSUER) {
      diags.push(diag("AUTH_UNVERIFIED", "critical", `relay ${relay.relay_id} issuer '${relay.issuer}' is not the trusted adapter`, relay.relay_id));
      return { state: "unverifiable", evidence_refs: [relay.relay_id], responsible: null };
    }
    if (relay.revoked) {
      diags.push(diag("AUTH_UNVERIFIED", "critical", `relay ${relay.relay_id} is revoked; jason authorization cannot be established`, relay.relay_id));
      return { state: "unverifiable", evidence_refs: [relay.relay_id], responsible: null };
    }
    if (!(relay.valid_from <= ctx.clock && ctx.clock < relay.expires_at)) {
      return { state: "outstanding", evidence_refs: [relay.relay_id], responsible: JASON };
    }
    if (relayDigest(relay) !== relay.digest) {
      diags.push(diag("HASH_MISMATCH", "error", `relay ${relay.relay_id} digest mismatch`, relay.relay_id));
      return { state: "unverifiable", evidence_refs: [relay.relay_id], responsible: null };
    }
    return { state: "satisfied", evidence_refs: [relay.relay_id], responsible: null };
  }
  diags.push(diag("INVALID_INPUT", "error", `unknown gate '${gateId}'`));
  return { state: "outstanding", evidence_refs: [], responsible: null };
}

function ruleApplies(rule, task, ctx) {
  if (!rule.action_ids.includes(task.action_type)) return false;
  if (rule.condition === "freeze-window") return inFreezeWindow(ctx.clock);
  return true;
}

/**
 * Full evaluation. Returns the agent payload (without the common envelope).
 */
export function evaluate(task, ctx, budget) {
  const diags = [];
  const quarantined = [];
  const satisfied = [];
  const outstanding = [];
  const cited = [];
  const registration_refs = [];
  const evidence_links = [];
  let responsible_actor = null;

  const failClosed = (code, severity, reason, extra = {}) => ({
    status: "CLASSIFIED",
    validity: "UNGROUNDED",
    classification: "DENIED",
    complete: false,
    diagnostics: [...diags, diag(code, severity, reason)],
    quarantined_sources: quarantined,
    routing_flags: [],
    policy_rule_cited: cited,
    registration_refs,
    evidence_links,
    requirements: { satisfied, outstanding },
    responsible_actor,
    evaluation_binding: {
      repo: task.target.repo,
      resource_id: task.target.resource_id,
      resource_class: task.target.resource_class,
      scope_ids: [...task.target.scope_ids].sort(),
      head: task.target.head,
      source_ref: task.target.source_ref,
    },
    evaluation_pins: null,
    authorization_granted: false,
    execution_performed: false,
    uncertainty_flags: [],
    ...extra,
  });

  // --- actor authentication ---
  const actor = principalById(ctx, task.actor_ref);
  if (!actor) {
    return failClosed("AUTH_UNVERIFIED", "error", `actor_ref '${task.actor_ref}' is not a registered fixture principal`);
  }

  // --- evidence reference validation + injection scan (references are not authority) ---
  for (const id of task.payload_context.evidence_record_ids) {
    budget.countObject(`evidence ${id}`);
    const ev = ctx.evidence[id];
    if (!ev) {
      return { ...failClosed("INVALID_INPUT", "error", `evidence_record_ids references unregistered record '${id}'`), status: "REFUSED" };
    }
    const recomputed = sha256HexBytes(Buffer.from(ev.bytes, "utf8"));
    if (recomputed !== ev.sha256) {
      return failClosed("HASH_MISMATCH", "error", `evidence record '${id}' hash mismatch`);
    }
    const directives = findDirectives(ev.bytes);
    if (directives.length > 0) {
      quarantined.push({ record_id: id, reason: `seeded directive pattern: ${directives.join(", ")}` });
      diags.push(diag("INSTRUCTION_INJECTION", "critical", `evidence record '${id}' carries seeded directive content; quarantined, cannot support success`, id));
    }
    if (ev.fixture_kind.startsWith("policy-claim:")) {
      const claimed = ev.fixture_kind.slice("policy-claim:".length);
      const [cpid, cver] = claimed.split("@");
      const registered = ctx.registrations.some(
        (r) => r.issuer === TRUSTED_ISSUER && !r.revoked && r.subject_ref === cpid && r.policy_version === cver &&
          r.valid_from <= ctx.clock && ctx.clock < r.expires_at
      );
      if (!registered) {
        diags.push(diag("AUTH_UNVERIFIED", "critical", `evidence '${id}' asserts policy '${claimed}' with no trusted registration; valid hash is not registration`, id));
        return failClosed("AUTH_UNVERIFIED", "critical", `unregistered policy claim '${claimed}' cannot ground an evaluation`);
      }
    }
    evidence_links.push({ record_id: id, fixture_kind: ev.fixture_kind, quarantined: directives.length > 0 });
  }

  // --- target head binding ---
  const headEntry = ctx.heads.find((h) => h.repo === task.target.repo && h.resource_id === task.target.resource_id);
  if (!headEntry) {
    return failClosed("TARGET_MISMATCH", "error", `no head-registry entry for ${task.target.repo}/${task.target.resource_id}`);
  }
  if (task.target.head !== headEntry.head) {
    return failClosed("TARGET_MISMATCH", "error", "task head does not match the independently current registry head");
  }
  const headSrc = resolveSourceRef(ctx, budget, task.target.source_ref);
  if (!headSrc.ok) {
    return failClosed(headSrc.code, "error", `target source_ref: ${headSrc.reason}`);
  }
  const regHeadSrc = resolveSourceRef(ctx, budget, headEntry.source_ref);
  if (!regHeadSrc.ok) {
    return failClosed(regHeadSrc.code, "error", `head-registry source_ref: ${regHeadSrc.reason}`);
  }

  // --- applicable policy registrations ---
  const applicable = applicableRegistrations(ctx, budget, task, diags);
  const fatalAuth = diags.some((d) => d.code === "AUTH_UNVERIFIED" && d.severity !== "warning");
  if (fatalAuth) {
    return failClosed("AUTH_UNVERIFIED", "critical", "authority records failed authentication; evaluation cannot proceed");
  }
  if (applicable.length === 0) {
    diags.push(diag("TARGET_MISMATCH", "warning", "no registered policy covers this exact action/target/scope; citing root default-deny rationale"));
    return {
      ...failClosed("TARGET_MISMATCH", "warning", "no registered policy covers this exact action/target/scope"),
      policy_rule_cited: [{ policy_id: "policy:default-deny", version: "1", rule_id: "rule:default-deny-rationale", citation: null }],
    };
  }

  // --- conflict resolution among applicable rules ---
  const rules = [];
  for (const { registration, policy } of applicable) {
    for (const rule of policy.rules) {
      if (ruleApplies(rule, task, ctx)) rules.push({ registration, policy, rule });
    }
  }
  const denies = rules.filter((r) => r.rule.effect === "deny");
  const nonDenies = rules.filter((r) => r.rule.effect !== "deny");
  // Authenticated resolution rule: when several rules apply, the strictly
  // highest-precedence policy wins; its winners must agree on effect.
  let effective = rules;
  if (rules.length > 1) {
    const byPrec = [...rules].sort((a, b) => b.policy.precedence - a.policy.precedence);
    const top = byPrec[0].policy.precedence;
    const winners = byPrec.filter((r) => r.policy.precedence === top);
    const winnerEffects = new Set(winners.map((r) => r.rule.effect));
    if (winnerEffects.size > 1) {
      return failClosed("AUTH_UNVERIFIED", "critical", "ambiguous overlapping effective policies with no authenticated resolution rule");
    }
    effective = winners;
    for (const loser of byPrec.filter((r) => r.policy.precedence !== top)) {
      diags.push(diag("PRECEDENCE_RESOLVED", "info", `lower-precedence rule ${loser.rule.rule_id} resolved away by the authenticated precedence rule`, loser.registration.record_id));
    }
  }
  const effDenies = effective.filter((r) => r.rule.effect === "deny");
  const effAllows = effective.filter((r) => r.rule.effect !== "deny");

  if (effDenies.length === 0 && effAllows.length === 0) {
    // Registrations exist but no rule actually governs this exact action
    // (e.g. every covering registration expired/revoked, or only
    // conditional rules whose conditions do not hold). Missing action
    // policy is UNGROUNDED DENIED, with the verified root default-deny
    // rationale cited separately.
    diags.push(diag("TARGET_MISMATCH", "warning", "no registered rule governs this exact action/target/scope; citing root default-deny rationale"));
    return {
      ...failClosed("TARGET_MISMATCH", "warning", "no registered rule governs this exact action/target/scope"),
      policy_rule_cited: [{ policy_id: "policy:default-deny", version: "1", rule_id: "rule:default-deny-rationale", citation: null }],
    };
  }

  // --- verified explicit prohibition (decision step 3) ---
  if (effDenies.length > 0) {
    const d = effDenies[0];
    const cit = citeRule(ctx, budget, d.policy, d.rule, diags, quarantined);
    if (!cit.ok) return failClosed(cit.code, "error", cit.reason);
    cited.push({ policy_id: d.policy.policy_id, version: d.policy.version, rule_id: d.rule.rule_id, citation: cit.citation });
    registration_refs.push(d.registration.record_id);
    return groundedResult(task, ctx, budget, "DENIED", diags, quarantined, cited, registration_refs, evidence_links, satisfied, outstanding, null, applicable);
  }

  // --- requirement evaluation (decision step 4/5) ---
  const gateIds = [...new Set(effAllows.flatMap((r) => r.rule.gates))];
  const citedRules = new Set();
  for (const { registration, policy, rule } of effAllows) {
    const cit = citeRule(ctx, budget, policy, rule, diags, quarantined);
    if (!cit.ok) return failClosed(cit.code, "error", cit.reason);
    const key = `${policy.policy_id}@${policy.version}#${rule.rule_id}`;
    if (!citedRules.has(key)) {
      citedRules.add(key);
      cited.push({ policy_id: policy.policy_id, version: policy.version, rule_id: rule.rule_id, citation: cit.citation });
    }
    if (!registration_refs.includes(registration.record_id)) registration_refs.push(registration.record_id);
  }

  const found = { verdict: null, agreement: null, fatal: [] };
  const needVerdict = gateIds.includes("req:reviewer-go") || gateIds.includes("req:muse-agreement");
  if (needVerdict) {
    const candidates = ctx.verdicts.filter(
      (v) => v.repo === task.target.repo && v.resource_id === task.target.resource_id &&
        sameScopeSet(v.scope_ids, task.target.scope_ids) && v.head === headEntry.head &&
        !v.revoked && v.valid_from <= ctx.clock && ctx.clock < v.expires_at
    );
    candidates.sort((a, b) => b.order_seq - a.order_seq);
    const newest = candidates[0] ?? null;
    if (newest) {
      // Authenticate the newest record before trusting any of its claims.
      if (verdictDigest(newest) !== newest.digest) {
        return failClosed("HASH_MISMATCH", "error", `verdict ${newest.verdict_id} digest mismatch`, { diagnostics: [...diags, diag("HASH_MISMATCH", "error", `verdict ${newest.verdict_id} digest mismatch`, newest.verdict_id)] });
      }
      const vsrc = resolveSourceRef(ctx, budget, newest.source_ref);
      if (!vsrc.ok) return failClosed(vsrc.code, "error", `verdict source_ref: ${vsrc.reason}`);
      if (!principalById(ctx, newest.reviewer_ref)) {
        return failClosed("AUTH_UNVERIFIED", "critical", `verdict reviewer '${newest.reviewer_ref}' is not a registered principal`);
      }
      if (newest.superseded_by) {
        return failClosed("STALE_EVIDENCE", "error", `newest verdict ${newest.verdict_id} is marked superseded by ${newest.superseded_by}`, { diagnostics: [...diags, diag("STALE_EVIDENCE", "error", `newest verdict ${newest.verdict_id} is marked superseded by ${newest.superseded_by}`, newest.verdict_id)] });
      }
      const invalidatedGo = candidates.find((o) => o !== newest && o.verdict === "GO" && o.superseded_by === newest.verdict_id);
      if (newest.verdict !== "GO") {
        if (invalidatedGo) {
          // A later applicable NEEDS-CHANGES/NO-GO invalidates the older GO
          // under trusted review-order metadata: stale evidence, fail closed.
          return failClosed("STALE_EVIDENCE", "error", `verdict ${invalidatedGo.verdict_id} (GO) was superseded by newer ${newest.verdict_id} (${newest.verdict})`, { diagnostics: [...diags, diag("STALE_EVIDENCE", "error", `verdict ${invalidatedGo.verdict_id} (GO) was superseded by newer ${newest.verdict_id} (${newest.verdict})`, invalidatedGo.verdict_id)] });
        }
        // Review state is negative/pending but no GO was invalidated: no
        // valid GO exists, so the review requirement stays outstanding.
      } else {
        found.verdict = newest;
      }
    }
  }
  if (gateIds.includes("req:muse-agreement")) {
    const as = ctx.agreements.filter(
      (a) => a.agent_ref === AGREEMENT_AGENT && a.head === headEntry.head && !a.revoked &&
        a.valid_from <= ctx.clock && ctx.clock < a.expires_at
    );
    found.agreement = as[0] ?? null;
  }

  let classification = "ALLOWED";
  for (const gid of gateIds) {
    const g = evaluateGate(ctx, budget, task, headEntry, gid, found, diags);
    const req = { requirement_id: gid, type: gateType(gid), state: g.state === "satisfied" ? "satisfied" : "outstanding", evidence_refs: g.evidence_refs, responsible_actor_ref: g.responsible };
    if (g.state === "satisfied") satisfied.push(req);
    else {
      outstanding.push(req);
      classification = "NEEDS-APPROVAL";
      if (g.state === "unverifiable") {
        return failClosed("AUTH_UNVERIFIED", "critical", "approval authority record failed authentication");
      }
      if (!responsible_actor && g.responsible) responsible_actor = g.responsible;
    }
  }
  if (found.fatal.length > 0) {
    return failClosed("AUTH_UNVERIFIED", "critical", "control-bearing record conflict: agreement/verdict binding mismatch");
  }

  if (quarantined.length > 0 && classification === "ALLOWED") {
    // Quarantined sources cannot support success; fail closed.
    return failClosed("INSTRUCTION_INJECTION", "critical", "quarantined sources present; no success outcome permitted");
  }

  return groundedResult(task, ctx, budget, classification, diags, quarantined, cited, registration_refs, evidence_links, satisfied, outstanding, responsible_actor, applicable);
}

function gateType(gid) {
  if (gid === "req:reviewer-go") return "review";
  if (gid === "req:muse-agreement") return "agreement";
  if (gid === "req:jason-authorization") return "authorization";
  return "gate";
}

/** Verify + build a citation for a rule; quarantines directive-bearing docs. */
function citeRule(ctx, budget, policy, rule, diags, quarantined) {
  const span = policy.rule_spans[rule.rule_id];
  if (!span) return { ok: false, code: "SOURCE_UNVERIFIED", reason: `no citation span for rule ${rule.rule_id}` };
  const res = verifyCitation(ctx, budget, policy.citation_doc, span);
  if (!res.ok) return { ok: false, code: res.code, reason: res.reason };
  const directives = findDirectives(span.quoted_text);
  if (directives.length > 0) {
    // GOV-003: quarantined sources are dropped from the consulted list.
    budget.dropSourceRef(policy.citation_doc);
    quarantined.push({ repo: policy.citation_doc.repo, path: policy.citation_doc.path, reason: `seeded directive pattern in cited span: ${directives.join(", ")}` });
    diags.push(diag("INSTRUCTION_INJECTION", "critical", `policy source for ${policy.policy_id} carries seeded directive content; quarantined`, null, policy.citation_doc));
    return { ok: false, code: "INSTRUCTION_INJECTION", reason: `cited policy source for ${policy.policy_id} quarantined` };
  }
  return { ok: true, citation: res.citation };
}

function groundedResult(task, ctx, budget, classification, diags, quarantined, cited, registration_refs, evidence_links, satisfied, outstanding, responsible_actor, applicable) {
  const policyDigests = {};
  for (const { policy } of applicable) {
    policyDigests[`${policy.policy_id}@${policy.version}`] = policy.policy_sha256;
  }
  const pins = {
    policy_sha256: policyDigests,
    registration_digest: sha256HexUtf8(applicable.map((a) => a.registration.record_id).sort()),
    principal_digest: sha256HexUtf8(ctx.principals.map((p) => p.principal_id).sort()),
    verdict_digest: sha256HexUtf8(ctx.verdicts.map((v) => v.verdict_id).sort()),
    agreement_digest: sha256HexUtf8(ctx.agreements.map((a) => a.agreement_id).sort()),
    relay_digest: sha256HexUtf8(ctx.relays.map((r) => r.relay_id).sort()),
    evaluated_at: new Date(ctx.clock).toISOString(),
  };
  return {
    status: "CLASSIFIED",
    validity: "GROUNDED",
    classification,
    complete: true,
    diagnostics: diags,
    quarantined_sources: quarantined,
    routing_flags: classification === "NEEDS-APPROVAL" && responsible_actor ? [`route:${responsible_actor}`] : [],
    policy_rule_cited: cited,
    registration_refs,
    evidence_links,
    requirements: { satisfied, outstanding },
    responsible_actor,
    evaluation_binding: {
      repo: task.target.repo,
      resource_id: task.target.resource_id,
      resource_class: task.target.resource_class,
      scope_ids: [...task.target.scope_ids].sort(),
      head: task.target.head,
      source_ref: task.target.source_ref,
    },
    evaluation_pins: pins,
    authorization_granted: false,
    execution_performed: false,
    uncertainty_flags: [],
  };
}
