// AI Lab Coordinator — Phase 2 fixture-only prototype.
//
// A read-only, deterministic evidence/state classification engine. It
// ingests allowlisted SYNTHETIC artifacts and classifies task state,
// review state, Muse agreement, Jason authorization, and merge
// eligibility as INDEPENDENT flags. It executes nothing: there is no merge,
// deploy, network, filesystem, or GitHub capability anywhere in this module.
//
// Contract highlights (Phase 1 discovery v6):
//  - `Submitted by:` text is descriptive, never authentication.
//  - Authorization provenance comes only from the injected
//    TrustedProvenanceRegistry / TrustedChannelStore, consulted on EVERY
//    evaluation (expiry/revocation/removal take effect immediately).
//  - Missing/invalid provenance fails closed: provenance "unknown"
//    ("authorization provenance unknown"), jason_authorized=false,
//    agreement_check_passed=false, merge_eligible=false.
//  - merge_eligible=true requires latest exact-head GO + independently
//    attested Muse agreement + applicable Jason authorization. It is an
//    informational classification only.
//  - Historical merges recorded without tokens keep provenance "unknown"
//    and are NOT retroactively invalidated.

import { resolveAttribution, UNRESOLVED_MUSE } from "./principals.mjs";
import {
  sourceFileId,
  submissionIdFor,
  reviewIdFor,
  validateArtifactShape,
  hasInertInstructionText,
} from "./artifacts.mjs";
import { validateRatificationToken, scopeCovers, AUTHORIZATION_PROVENANCE_UNKNOWN } from "./tokens.mjs";

const AGREEMENT_SCOPE = "agreement-check";
const AGREEMENT_PRINCIPAL = "koe-sr"; // Muse's technical agreement check
const REVIEWER_PRINCIPAL = "chatgpt";
const DEFAULT_EVAL_TIME = "1970-01-01T00:00:00.000Z"; // tokens fail closed without an explicit evaluation time

function attributionOf(artifact, aliasMap) {
  return resolveAttribution({
    submittedBy: artifact.submittedBy,
    principalId: artifact.principal_id,
    hint: artifact.attribution_hint,
    aliasMap,
  });
}

function principalKey(attribution) {
  if (attribution.status === "principal") return attribution.principal_id;
  if (attribution.status === "unresolved") return UNRESOLVED_MUSE;
  return null;
}

function emptyRecord(taskId) {
  return {
    task_id: taskId,
    taskArtifact: null,
    ownerKey: null,
    scope: null,
    code_head_sha: null,
    submissions: [],
    reviews: [],
    agreementChecks: [],
    authorizations: [],
    authorizationClaims: [],
    standingRules: [],
    mergedRecords: [],
    seenFiles: new Set(),
    quarantine: [],
  };
}

export function createCoordinator({ registry = null, channelStore = null, aliasMap = null } = {}) {
  const tasks = new Map();

  function recordFor(taskId) {
    if (!tasks.has(taskId)) tasks.set(taskId, emptyRecord(taskId));
    return tasks.get(taskId);
  }

  // Ingest one synthetic artifact. Returns a deterministic ingest outcome:
  // { status: "recorded" | "duplicate" | "rejected" | "quarantined", ... }
  function ingest(artifact) {
    const shapeReasons = validateArtifactShape(artifact);
    if (shapeReasons.length > 0) {
      return { status: "rejected", task_id: artifact?.task_id ?? null, reasons: shapeReasons };
    }

    const record = recordFor(artifact.task_id);
    const sfid = sourceFileId(artifact);
    const dedupKey = `${sfid.path}|${sfid.content_sha256}`;
    if (record.seenFiles.has(dedupKey)) {
      return { status: "duplicate", task_id: artifact.task_id, source_file_id: sfid, reasons: ["duplicate artifact identity (task_id, source_file_id); no-op"] };
    }

    const attribution = attributionOf(artifact, aliasMap);
    const entry = { artifact, sfid, attribution };

    switch (artifact.kind) {
      case "task": {
        const ownerKey = principalKey(attribution) ?? `unknown:${attribution.claimed ?? "none"}`;
        if (record.taskArtifact && record.ownerKey !== ownerKey) {
          const reason = `owner mismatch: task registered under ${record.ownerKey}, resubmitted claiming ${ownerKey} with no handoff record`;
          record.quarantine.push({ artifact_path: artifact.path, reason });
          record.seenFiles.add(dedupKey);
          return { status: "quarantined", task_id: artifact.task_id, source_file_id: sfid, reasons: [reason] };
        }
        record.taskArtifact = entry;
        record.ownerKey = ownerKey;
        record.scope = artifact.scope ?? record.scope ?? "merge";
        if (artifact.code_head_sha != null) record.code_head_sha = artifact.code_head_sha;
        break;
      }
      case "submission":
        entry.submission_id = submissionIdFor(artifact.task_id, artifact);
        record.submissions.push(entry);
        if (artifact.code_head_sha != null) record.code_head_sha = artifact.code_head_sha;
        break;
      case "review":
        entry.review_id = reviewIdFor(artifact.task_id, artifact);
        record.reviews.push(entry);
        break;
      case "agreement-check":
        record.agreementChecks.push(entry);
        break;
      case "authorization":
        record.authorizations.push(entry);
        break;
      case "authorization-claim":
        record.authorizationClaims.push(entry);
        break;
      case "standing-rule":
        record.standingRules.push(entry);
        break;
      case "merged-record":
        record.mergedRecords.push(entry);
        break;
      default:
        return { status: "rejected", task_id: artifact.task_id, reasons: [`unhandled kind ${artifact.kind}`] };
    }

    record.seenFiles.add(dedupKey);
    const out = { status: "recorded", task_id: artifact.task_id, source_file_id: sfid };
    if (entry.submission_id) out.submission_id = entry.submission_id;
    if (entry.review_id) out.review_id = entry.review_id;
    return out;
  }

  // --- attestation helpers (read-only against the injected stores) ---

  function registryPrincipalFor(artifact) {
    if (!registry) return null;
    return registry.lookupPrincipal({
      run_id: artifact.evidence_run_id,
      authorization_id: artifact.authorization_id,
    });
  }

  // Find a valid token for a claim. With `boundOnly`, standing tokens
  // (task_id null) are skipped: a standing token ratifies the standing
  // RULE (its declared process), so it can only authorize through the
  // standing-rule path with every precondition evidenced -- never as a
  // blanket per-task authorization on scope match alone.
  function validTokenFor(claim, reasons, { boundOnly = false, standingOnly = false } = {}) {
    if (!channelStore) {
      reasons.add("no trusted channel store injected; ratification tokens cannot be validated");
    }
    const tokens = channelStore ? channelStore.listTokens() : [];
    let valid = null;
    for (const token of tokens) {
      if (boundOnly && token.task_id == null) continue;
      if (standingOnly && token.task_id != null) continue;
      const result = validateRatificationToken(token, claim, claim.now);
      if (result.valid) {
        valid = token;
        break;
      }
      for (const r of result.reasons) reasons.add(`token ${token.token_id}: ${r}`);
    }
    if (!valid && tokens.length === 0) {
      reasons.add("no ratification token present in the trusted channel store");
    }
    return valid;
  }

  // Agreement evidence quality gates. A passed agreement check must (a) be
  // bound to an explicit code head equal to the task's current head --
  // exact-head verification happens on EVERY evaluation, and (b) carry an
  // explicit checks payload with every required technical predicate true.
  // Standing-rule precondition checks alone never close the registry/token
  // agreement paths: the payload is validated on both.
  const AGREEMENT_REQUIRED_CHECKS = ["exact_head_match", "zero_conflict_markers", "files_in_scope"];

  function agreementHeadVerified(a, currentHead, reasons) {
    if (currentHead == null) {
      reasons.add(`agreement check at ${a.path} cannot be exact-head verified: the task's current head is unknown`);
      return false;
    }
    if (a.code_head_sha == null) {
      reasons.add(`agreement check at ${a.path} has no code head binding; an exact-head agreement requires an explicit head`);
      return false;
    }
    if (a.code_head_sha !== currentHead) {
      reasons.add(`agreement check at ${a.path} is bound to head ${a.code_head_sha}, not current head ${currentHead}`);
      return false;
    }
    return true;
  }

  function agreementChecksVerified(a, reasons) {
    const checks = a.checks ?? {};
    const unmet = AGREEMENT_REQUIRED_CHECKS.filter((name) => checks[name] !== true);
    if (unmet.length > 0) {
      for (const name of unmet) {
        reasons.add(`agreement check at ${a.path}: required check "${name}" is ${checks[name] === false ? "false" : "missing"}, not true`);
      }
      return false;
    }
    return true;
  }

  // Muse agreement: counts only when independently attested (registry
  // entry binding the run to koe-sr, or a channel token covering the
  // agreement-check scope). Text attribution alone never suffices.
  function evaluateAgreement(record, currentHead, now, reasons) {
    let tier = null;
    let sawHeadMismatch = false;
    for (const entry of record.agreementChecks) {
      const a = entry.artifact;
      const headOk = agreementHeadVerified(a, currentHead, reasons);
      if (!headOk && a.code_head_sha != null && currentHead != null && a.code_head_sha !== currentHead) {
        sawHeadMismatch = true;
      }
      if (!headOk || !agreementChecksVerified(a, reasons)) {
        continue;
      }
      const claimed = principalKey(entry.attribution);
      const attested = registryPrincipalFor(a);
      if (attested != null) {
        if (attested === AGREEMENT_PRINCIPAL) {
          tier = "cryptographically_authenticated";
          reasons.add(`agreement check at ${a.path} independently attested to ${AGREEMENT_PRINCIPAL} by the trusted registry`);
          return { passed: true, tier, entry };
        }
        reasons.add(`agreement run at ${a.path} is attested to ${attested}, not ${AGREEMENT_PRINCIPAL}`);
        continue;
      }
      if (claimed !== AGREEMENT_PRINCIPAL) {
        reasons.add(
          entry.attribution.status === "unresolved"
            ? `agreement check at ${a.path} has ambiguous Muse attribution (${UNRESOLVED_MUSE}); cannot satisfy the agreement check`
            : `agreement check at ${a.path} does not resolve to ${AGREEMENT_PRINCIPAL}`,
        );
        continue;
      }
      const token = validTokenFor({ scope: AGREEMENT_SCOPE, task_id: record.task_id, code_head_sha: currentHead, now }, reasons);
      if (token) {
        tier = "jason_ratified_process";
        reasons.add(`agreement check at ${a.path} covered by ratification token ${token.token_id}`);
        return { passed: true, tier, entry };
      }
    }
    if (record.agreementChecks.length === 0) {
      reasons.add("no Muse agreement-check evidence filed");
    } else if (!sawHeadMismatch) {
      reasons.add("agreement-check evidence is not independently attested (no registry entry, no channel token)");
    }
    return { passed: false, tier: null, entry: null };
  }

  // Jason authorization via: (a) registry-attested jason authorization
  // evidence, (b) a valid channel RatificationToken, or (c) a standing-rule
  // path (standing-scope token + attested agreement evidencing every
  // precondition). Returns { authorized, tier, agreementEntry }.
  function evaluateAuthorization(record, claimScope, currentHead, now, agreement, reasons, quarantineReasons) {
    // (a) Direct authorization evidence, authenticated by the registry.
    for (const entry of record.authorizations) {
      const a = entry.artifact;
      const claimed = principalKey(entry.attribution);
      if (claimed !== "jason") {
        reasons.add(
          `claimed evidence at ${a.path} does not substantiate jason_authorized: attribution resolves to ${claimed ?? entry.attribution.basis}, not jason`,
        );
        continue;
      }
      if (a.code_head_sha != null && currentHead != null && a.code_head_sha !== currentHead) {
        reasons.add(`authorization evidence at ${a.path} is bound to head ${a.code_head_sha}, not current head ${currentHead}`);
        continue;
      }
      if (!scopeCovers(a.scope ?? claimScope, claimScope)) {
        reasons.add(`authorization evidence at ${a.path} scope "${a.scope ?? claimScope}" does not cover claim scope "${claimScope}"`);
        continue;
      }
      const attested = registryPrincipalFor(a);
      if (attested === "jason") {
        reasons.add(`authorization at ${a.path} independently attested to jason by the trusted registry`);
        return { authorized: true, tier: "cryptographically_authenticated" };
      }
      reasons.add(
        attested == null
          ? `authorization evidence at ${a.path} has no trusted registry attestation; text attribution is not authentication`
          : `authorization run at ${a.path} is attested to ${attested}, not jason`,
      );
    }

    // (c) Standing-rule path via authorization claims, and (b) token path.
    let claimWithoutSubstantiation = false;
    for (const entry of record.authorizationClaims) {
      const a = entry.artifact;
      if (a.token_id != null && channelStore && !channelStore.getToken(a.token_id)) {
        reasons.add(`claimed ratification token ${a.token_id} is not present in the trusted channel store`);
      }
      if (a.standing_rule_id != null) {
        const ruleEntry = record.standingRules.find((r) => r.artifact.rule_id === a.standing_rule_id);
        if (!ruleEntry) {
          reasons.add(`authorization claim at ${a.path} cites unknown standing rule ${a.standing_rule_id}`);
          claimWithoutSubstantiation = true;
          continue;
        }
        const rule = ruleEntry.artifact;
        if (!scopeCovers(rule.scope, claimScope)) {
          reasons.add(`standing rule ${rule.rule_id} scope "${rule.scope}" does not cover claim scope "${claimScope}"`);
          claimWithoutSubstantiation = true;
          continue;
        }
        const token = validTokenFor({ scope: claimScope, task_id: record.task_id, code_head_sha: currentHead, now }, reasons, { standingOnly: true });
        if (!token) {
          reasons.add(`standing rule ${rule.rule_id} has no applicable standing ratification token`);
          claimWithoutSubstantiation = true;
          continue;
        }
        if (!agreement.passed || !agreement.entry) {
          reasons.add(`standing rule ${rule.rule_id} requires an attested agreement check evidencing its preconditions`);
          claimWithoutSubstantiation = true;
          continue;
        }
        const checks = agreement.entry.artifact.checks ?? {};
        const unmet = (rule.preconditions ?? []).filter((name) => checks[name] !== true);
        if (unmet.length > 0) {
          for (const name of unmet) reasons.add(`standing-rule precondition not evidenced: ${name}`);
          claimWithoutSubstantiation = true;
          continue;
        }
        reasons.add(`authorization via standing rule ${rule.rule_id} (ratification token ${token.token_id}, all preconditions evidenced)`);
        return { authorized: true, tier: "jason_ratified_process" };
      }
      if (a.token_id == null && a.authorization_id == null) {
        claimWithoutSubstantiation = true;
      }
    }

    // (b) A task-bound channel token covering this claim. (Standing tokens
    // are handled exclusively by path (c) above.)
    const token = validTokenFor({ scope: claimScope, task_id: record.task_id, code_head_sha: currentHead, now }, reasons, { boundOnly: true });
    if (token) {
      reasons.add(`authorization via ratification token ${token.token_id} from the trusted channel store`);
      return { authorized: true, tier: "jason_ratified_process" };
    }

    if (claimWithoutSubstantiation) {
      quarantineReasons.add("absent approval evidence: authorization claim has no trusted substantiation (no valid channel token, registry attestation, or standing-rule path)");
    }
    if (record.authorizations.length === 0 && record.authorizationClaims.length === 0) {
      reasons.add("no Jason authorization evidence filed");
    }
    return { authorized: false, tier: null };
  }

  function evaluate(taskId, { now = DEFAULT_EVAL_TIME, live_code_head_sha = null } = {}) {
    const reasons = new Set();
    const quarantineReasons = new Set();
    const record = tasks.get(taskId);

    if (!record || !record.taskArtifact) {
      return {
        task_id: taskId,
        provenance: "unknown",
        provenance_label: AUTHORIZATION_PROVENANCE_UNKNOWN,
        owner_principal_id: null,
        code_head_sha: record?.code_head_sha ?? null,
        flags: {
          scoped: false,
          built_submitted: (record?.submissions.length ?? 0) > 0,
          reviewed: null,
          agreement_check_passed: false,
          jason_authorized: false,
          merge_eligible: false,
          merged: (record?.mergedRecords.length ?? 0) > 0,
          deployed: false,
          activated: false,
        },
        quarantine_reasons: [...(record?.quarantine.map((q) => q.reason) ?? [])].sort(),
        reasons: ["task is not registered (no task artifact); failing closed"],
        evidence_counts: {
          submissions: record?.submissions.length ?? 0,
          reviews: record?.reviews.length ?? 0,
          agreement_checks: record?.agreementChecks.length ?? 0,
          authorizations: record?.authorizations.length ?? 0,
          authorization_claims: record?.authorizationClaims.length ?? 0,
        },
        evaluated_at: now,
      };
    }

    for (const q of record.quarantine) quarantineReasons.add(q.reason);

    const currentHead = record.code_head_sha;
    const claimScope = record.scope ?? "merge";

    // Staleness: registered head no longer matches the live branch head.
    const stale = live_code_head_sha != null && currentHead != null && live_code_head_sha !== currentHead;
    if (stale) {
      quarantineReasons.add(`stale SHA: registered head ${currentHead} no longer matches live head ${live_code_head_sha}`);
    }

    // --- review state (latest round at the current head) ---
    let reviewed = null;
    const validReviews = [];
    for (const entry of record.reviews) {
      if (principalKey(entry.attribution) !== REVIEWER_PRINCIPAL) {
        quarantineReasons.add(`review at ${entry.artifact.path} is not from the reviewer principal (${REVIEWER_PRINCIPAL}); ignored`);
        continue;
      }
      validReviews.push(entry);
    }
    if (validReviews.length > 0) {
      const latestRound = Math.max(...validReviews.map((e) => e.artifact.review_round));
      const latest = validReviews.filter((e) => e.artifact.review_round === latestRound);
      const verdicts = new Set(latest.map((e) => e.artifact.verdict));
      if (verdicts.size > 1) {
        quarantineReasons.add(`conflicting reviews at round ${latestRound}: ${[...verdicts].sort().join(" vs ")}; failing closed`);
        reviewed = { round: latestRound, verdict: "conflicting", at_current_head: false, review_id: null };
      } else {
        const winner = latest[0];
        const atHead = !stale && winner.artifact.code_head_sha != null && currentHead != null && winner.artifact.code_head_sha === currentHead;
        reviewed = {
          round: latestRound,
          verdict: winner.artifact.verdict,
          at_current_head: atHead,
          review_id: winner.review_id,
        };
        if (!atHead) {
          reasons.add(`latest review (round ${latestRound}, ${winner.artifact.verdict}) is bound to head ${winner.artifact.code_head_sha ?? "none"}, not current head ${currentHead ?? "none"}`);
        }
      }
    }

    // --- Muse agreement (independently attested) ---
    const agreement = evaluateAgreement(record, currentHead, now, reasons);

    // --- Jason authorization (trusted input only) ---
    const authorization = evaluateAuthorization(record, claimScope, currentHead, now, agreement, reasons, quarantineReasons);

    const provenance = authorization.tier ?? "unknown";
    const jasonAuthorized = authorization.authorized;
    const agreementPassed = agreement.passed;

    const goAtCurrentHead = reviewed != null && reviewed.verdict === "go" && reviewed.at_current_head;
    const mergeEligible =
      goAtCurrentHead && agreementPassed && jasonAuthorized && quarantineReasons.size === 0 && !stale;

    if (goAtCurrentHead && agreementPassed && !jasonAuthorized) {
      reasons.add("technical check passed; Jason has not authorized merge");
    }
    if (reviewed?.verdict === "go" && !reviewed.at_current_head) {
      reasons.add("GO does not carry to a different head; a fresh exact-head review is required");
    }

    const merged = record.mergedRecords.length > 0;
    if (merged) {
      reasons.add(
        provenance === "unknown"
          ? "historical merge recorded from source evidence; provenance unknown under the v6 contract; not retroactively invalidated"
          : "merge recorded from source evidence",
      );
    }

    const inertText = [...record.submissions, ...record.reviews, ...record.authorizationClaims].some((e) =>
      hasInertInstructionText(e.artifact),
    );
    if (inertText) {
      reasons.add("instruction-like free text present in artifact body; treated as inert data and ignored");
    }

    return {
      task_id: taskId,
      provenance,
      provenance_label: provenance === "unknown" ? AUTHORIZATION_PROVENANCE_UNKNOWN : provenance,
      owner_principal_id: record.ownerKey,
      code_head_sha: currentHead,
      flags: {
        scoped: true,
        built_submitted: record.submissions.length > 0,
        reviewed,
        agreement_check_passed: agreementPassed,
        jason_authorized: jasonAuthorized,
        merge_eligible: mergeEligible,
        merged,
        deployed: false,
        activated: false,
      },
      agreement_tier: agreement.tier,
      authorization_tier: authorization.tier,
      evidence_counts: {
        submissions: record.submissions.length,
        reviews: record.reviews.length,
        agreement_checks: record.agreementChecks.length,
        authorizations: record.authorizations.length,
        authorization_claims: record.authorizationClaims.length,
      },
      quarantine_reasons: [...quarantineReasons].sort(),
      reasons: [...reasons].sort(),
      evaluated_at: now,
    };
  }

  return {
    ingest,
    evaluate,
    listTasks() {
      return [...tasks.keys()].sort();
    },
  };
}
