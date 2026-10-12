/**
 * supersession.js — steward authentication and effective-revision
 * selection for the knowledge-vault prototype.
 *
 * Only REGISTERED supersession records determine the effective revision.
 * No source-internal chain fallback (supersedes: lines in source bytes are
 * ignored), no commit-order heuristic, no revision-name authority.
 * Current queries select only uniquely effective registered revisions in
 * scope; ambiguous or missing records retain uncertainty — never a claim
 * of current policy. Out-of-scope or read-denied replacements cannot be
 * used and cannot leak quoted text.
 * Pure Node 24 ESM, zero dependencies.
 */

import { resolveSourceRef, hasReadGrant, ResolutionError, BudgetError } from "./resolver.js";

/**
 * Authenticate one supersession record: steward registration, authority
 * scope COVERAGE (every record scope must fall inside the steward's
 * authenticated authority — one overlapping token never authorizes a
 * mixed-scope record), exact old/new source/version applicability from
 * the registration, action registration, both pins, and read permission
 * on the replacement. Returns {authenticated, flags:[{record_id, reason}]} —
 * never throws for record problems (pins use the resolver and may throw
 * ResolutionError, which is caught and reported as unauthenticated).
 * BudgetError is never swallowed: it propagates to the public
 * INPUT_LIMIT/BUDGET_EXCEEDED refusal.
 */
export function authenticateRecord(record, ctx, clockMs, budget) {
  const flags = [];
  const deny = (reason) => ({ authenticated: false, flags: [...flags, { record_id: record.record_id, reason }] });
  if (budget) budget.countConsulted("supersession record");

  const steward = ctx.stewards.find((s) => s.steward_id === record.issuer);
  if (budget) budget.countConsulted("steward lookup");
  if (!steward) return deny(`issuer '${record.issuer}' is not a registered steward`);
  if (steward.revoked) return deny(`steward '${record.issuer}' is revoked`);
  const vf = Date.parse(steward.valid_from);
  const ex = Date.parse(steward.expires_at);
  if (!(vf <= clockMs && clockMs < ex)) return deny(`steward '${record.issuer}' is not valid at the task clock`);

  const registration = ctx.registrations.find((r) => r.registration_ref === record.registration_ref);
  if (budget) budget.countConsulted("registration lookup");
  if (!registration) return deny(`registration '${record.registration_ref}' not found`);
  if (registration.steward_id !== record.issuer) return deny(`registration '${record.registration_ref}' does not belong to issuer '${record.issuer}'`);
  if (registration.revoked) return deny(`registration '${record.registration_ref}' is revoked`);
  const rvf = Date.parse(registration.valid_from);
  const rex = Date.parse(registration.expires_at);
  if (!(rvf <= clockMs && clockMs < rex)) return deny(`registration '${record.registration_ref}' is not valid at the task clock`);
  if (!registration.action_ids.includes("supersede")) {
    return deny(`registration '${record.registration_ref}' does not authorize the 'supersede' action`);
  }

  // Authority coverage: EVERY record scope must be inside the steward's
  // authenticated authority. A record naming scopes the steward was
  // never granted cannot ride in on one overlapping scope token.
  const uncovered = record.scope_ids.filter((s) => !steward.authority_scope_ids.includes(s));
  if (uncovered.length > 0) {
    return deny(`steward '${record.issuer}' has no authority over record scope(s) [${uncovered.join(",")}]`);
  }

  // Exact applicability from the trusted registration: the record's
  // scopes and its exact old/new source keys must fall inside what the
  // adapter registered for this steward+action. Generic "may supersede
  // anything" grants are rejected at validation time.
  const app = registration.applicability;
  if (app) {
    const appUncovered = record.scope_ids.filter((s) => !app.scope_ids.includes(s));
    if (appUncovered.length > 0) {
      return deny(`registration '${record.registration_ref}' applicability does not cover record scope(s) [${appUncovered.join(",")}]`);
    }
    for (const which of ["old_ref", "new_ref"]) {
      const sk = sourceKeyOfRef(record[which]);
      if (!app.source_keys.includes(sk)) {
        return deny(`registration '${record.registration_ref}' applicability does not cover record ${which} source '${sk}'`);
      }
    }
  }

  // Both pins must resolve through the fixture Git object store.
  try {
    resolveSourceRef(record.old_ref, ctx.sources, budget);
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    const code = e instanceof ResolutionError ? e.code : "SOURCE_UNVERIFIED";
    return deny(`old_ref pin failed (${code}): ${e.message}`);
  }
  try {
    resolveSourceRef(record.new_ref, ctx.sources, budget);
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    const code = e instanceof ResolutionError ? e.code : "SOURCE_UNVERIFIED";
    return deny(`new_ref pin failed (${code}): ${e.message}`);
  }

  if (!hasReadGrant(record.new_ref, ctx.readGrants)) {
    return deny(`read permission denied for replacement ${record.new_ref.repo}/${record.new_ref.path}@${record.new_ref.commit.slice(0, 8)}`);
  }

  return { authenticated: true, flags };
}

function sourceKeyOfRef(ref) {
  return `${ref.repo}|${ref.path}`;
}

/** Intersection of scope id lists (null when no records applied). */
function intersectScopes(lists) {
  if (lists.length === 0) return null;
  let acc = new Set(lists[0]);
  for (const l of lists.slice(1)) acc = new Set([...acc].filter((s) => l.includes(s)));
  return [...acc].sort();
}

/**
 * Select the effective revision for a source key at time T.
 *
 * @param {string} sourceKey "repo|path"
 * @param {string[]} queryScopes union of claim scopes for the query_key
 * @param {object} ctx validated context
 * @param {number} clockMs task clock
 * @param {number|null} asOfMs historical pin (null = current)
 * @param {object} budget
 * @returns {status:"ok", ref:{repo,path,commit}, appliedRecords:[record_id],
 *           appliedScopeIds:[scope]|null, stewardFlags:[...]} |
 *          {status:"ambiguous"|"uncertain"|"read-denied", reason, code,
 *           reducesConfidence:boolean, stewardFlags:[...]}
 *
 * reducesConfidence marks a REAL coverage gap (multiple undetermined
 * candidates, competing records, broken chain): the source held relevant
 * facts that could not be resolved. It is false for pure temporal
 * inapplicability (no revision effective at T) — correctly excluding a
 * not-yet-existing revision is not missing coverage.
 * appliedScopeIds is the intersection of the applied records' scopes:
 * only facts covered by that authenticated scope may be emitted from
 * the selected revision (no scope expansion via the query-scope union).
 */
export function selectEffectiveRevision(sourceKey, queryScopes, ctx, clockMs, asOfMs, budget) {
  const T = asOfMs === null || asOfMs === undefined ? clockMs : asOfMs;
  const entry = ctx.sources[sourceKey];
  if (!entry || !entry.revisions || typeof entry.revisions !== "object") {
    return { status: "uncertain", reason: `no revisions registered for ${sourceKey}`, code: "SOURCE_UNVERIFIED", reducesConfidence: true };
  }
  const commits = Object.keys(entry.revisions);
  if (commits.length === 0) {
    return { status: "uncertain", reason: `no revisions registered for ${sourceKey}`, code: "SOURCE_UNVERIFIED", reducesConfidence: true };
  }

  // Revisions not yet effective at T cannot be selected. Source age and
  // effectiveness come from the authenticated ledger times, never file
  // mtime. A historical query before any revision existed retains
  // uncertainty rather than leaking a future revision.
  const effectiveCommits = commits.filter((c) => {
    const ms = Date.parse(entry.revisions[c].effective_at);
    return Number.isFinite(ms) && ms <= T;
  });
  if (effectiveCommits.length === 0) {
    return {
      status: "uncertain",
      reason: `no revision of ${sourceKey} is effective at ${new Date(T).toISOString()}`,
      code: "STALE_EVIDENCE",
      reducesConfidence: false,
      stewardFlags: [],
    };
  }
  // From here on, only effective-at-T revisions participate.
  const revs = effectiveCommits;

  // 1. Authenticate every registered record whose old_ref names this
  //    source key; records effective at T and in scope form the chain
  //    candidates. A future record neither forks the chain nor takes
  //    effect — the revision-time filter above already removed its
  //    not-yet-effective target revision.
  const candidates = [];
  const stewardFlags = [];
  for (const record of ctx.supersessionRecords) {
    if (sourceKeyOfRef(record.old_ref) !== sourceKey) continue;
    const { authenticated, flags } = authenticateRecord(record, ctx, clockMs, budget);
    stewardFlags.push(...flags);
    if (!authenticated) continue;
    if (Date.parse(record.effective_at) > T) continue; // not yet effective
    if (!record.scope_ids.some((s) => queryScopes.includes(s))) continue; // out of scope
    if (!revs.includes(record.old_ref.commit)) continue;
    candidates.push(record);
  }

  if (candidates.length === 0) {
    if (revs.length === 1) {
      const [brepo, bpath] = sourceKey.split("|");
      return finishSelection(brepo, bpath, revs[0], ctx, [], stewardFlags);
    }
    return {
      status: "uncertain",
      reason: `no registered supersession records and ${revs.length} candidate revisions for ${sourceKey}: current revision is not uniquely determined`,
      code: "STALE_EVIDENCE",
      reducesConfidence: true,
      stewardFlags,
    };
  }

  // 2. Fork check: two records superseding the same old commit to
  //    different new commits retain uncertainty (never pick a winner).
  const byOld = new Map();
  for (const r of candidates) {
    const k = `${r.old_ref.repo}|${r.old_ref.path}|${r.old_ref.commit}`;
    if (!byOld.has(k)) byOld.set(k, new Set());
    byOld.get(k).add(`${r.new_ref.repo}|${r.new_ref.path}|${r.new_ref.commit}`);
  }
  for (const [k, news] of byOld) {
    if (news.size > 1) {
      return {
        status: "ambiguous",
        reason: `competing supersession records for ${k}: ${news.size} different replacements registered`,
        code: "STALE_EVIDENCE",
        reducesConfidence: true,
        stewardFlags,
      };
    }
  }

  // 3. Base revision: the one no candidate supersedes away from (same key).
  const asNew = new Set(
    candidates.filter((r) => sourceKeyOfRef(r.new_ref) === sourceKey).map((r) => r.new_ref.commit)
  );
  const bases = revs.filter((c) => !asNew.has(c));
  if (bases.length !== 1) {
    return { status: "ambiguous", reason: `supersession chain for ${sourceKey} has no unique base revision`, code: "STALE_EVIDENCE", reducesConfidence: true, stewardFlags };
  }

  // 4. Walk the chain in effective_at order (all candidates are
  //    effective at T). A broken link retains uncertainty.
  const [srepo, spath] = sourceKey.split("|");
  const ordered = [...candidates].sort((a, b) => (a.effective_at < b.effective_at ? -1 : a.effective_at > b.effective_at ? 1 : 0));
  let head = { repo: srepo, path: spath, commit: bases[0] };
  const applied = [];
  for (const record of ordered) {
    if (record.old_ref.commit !== head.commit || sourceKeyOfRef(record.old_ref) !== `${head.repo}|${head.path}`) {
      return {
        status: "ambiguous",
        reason: `supersession chain broken for ${sourceKey}: record '${record.record_id}' does not continue from the chain head`,
        code: "STALE_EVIDENCE",
        reducesConfidence: true,
        stewardFlags,
      };
    }
    head = { repo: record.new_ref.repo, path: record.new_ref.path, commit: record.new_ref.commit };
    applied.push(record);
  }
  return finishSelection(head.repo, head.path, head.commit, ctx, applied, stewardFlags);
}

/** Read-permission gate on the selected revision (no text may leak). */
function finishSelection(repo, path, commit, ctx, appliedRecords, stewardFlags) {
  // Permission is an exact repo+path grant decision; no bytes are read here.
  const granted = hasReadGrant({ repo, path }, ctx.readGrants);
  if (!granted) {
    return {
      status: "read-denied",
      reason: `effective revision of ${repo}|${path} is not covered by a read grant; its content cannot be used or quoted`,
      code: "READ_DENIED",
      reducesConfidence: false,
      stewardFlags,
    };
  }
  const appliedScopeIds = intersectScopes(appliedRecords.map((r) => r.scope_ids));
  return {
    status: "ok",
    ref: { repo, path, commit },
    appliedRecords: appliedRecords.map((r) => r.record_id),
    appliedScopeIds,
    stewardFlags,
  };
}
