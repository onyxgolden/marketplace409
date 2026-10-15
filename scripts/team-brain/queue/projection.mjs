// Team Brain slice 1 — deterministic executive queue projection.
//
// Pure function: ledger state + injected UTC `now` -> queue status.
// No I/O, no clock reads, no network, no model calls, no sends.
// The library NEVER sends a message; callers persist REPING_SENT /
// REPORT_TO_JASON_SENT events before the next projection can advance.

import { CODES, fail } from "../ledger/errors.mjs";
import { assertOverrideStructure, utcIsoToMs } from "../ledger/validation.mjs";

export const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

const TERMINAL_STATES = new Set(["CLOSED", "REVOKED", "SUPERSEDED"]);

// An override is valid only when its authorityRef resolves against
// host-injected trusted Jason authorization records. Each record binds a
// grant to a specific obligation item; the projection rejects unknown refs,
// non-Jason granters, wrong-item bindings, and revoked grants. Text that
// merely begins with "Jason" is content, not authority, and is rejected at
// the structural layer (see assertOverrideStructure).
export function validateOverride(id, override, { trustedAuthorizations = [] } = {}) {
  const structural = assertOverrideStructure(override, id);
  if (structural == null) return null;
  const { authorityRef } = structural;
  const record = trustedAuthorizations.find((r) => r != null && r.id === authorityRef);
  if (!record) {
    fail(CODES.UNKNOWN_AUTHORITY, `Priority override for ${id} rejected: unknown authority reference ${authorityRef}`, {
      id,
      authorityRef,
    });
  }
  if (record.granter !== "Jason") {
    fail(
      CODES.INVALID_OVERRIDE,
      `Priority override for ${id} rejected: authority ${authorityRef} is not a Jason grant`,
      { id, authorityRef, granter: record.granter },
    );
  }
  if (record.itemId !== id) {
    fail(
      CODES.INVALID_OVERRIDE,
      `Priority override for ${id} rejected: authority ${authorityRef} binds item ${record.itemId}`,
      { id, authorityRef, boundItem: record.itemId },
    );
  }
  if (record.revoked) {
    fail(CODES.INVALID_OVERRIDE, `Priority override for ${id} rejected: authority ${authorityRef} is revoked`, {
      id,
      authorityRef,
    });
  }
  if (record.rank !== undefined && record.rank !== structural.rank) {
    fail(
      CODES.INVALID_OVERRIDE,
      `Priority override for ${id} rejected: authority ${authorityRef} permits rank ${record.rank}`,
      { id, authorityRef, permittedRank: record.rank, rank: structural.rank },
    );
  }
  return {
    ...structural,
    recordedAtMs: utcIsoToMs(structural.recordedAt, `override.recordedAt for ${id}`),
  };
}

// Deterministic cycle detection over the known-id graph. Fails closed with a
// stable diagnostic naming the cycle members; never guesses an order.
function detectCycle(items) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(items.map((i) => [i.id, WHITE]));
  const stack = [];

  function visit(id) {
    color.set(id, GRAY);
    stack.push(id);
    const node = byId.get(id);
    const deps = [...(node.deps || [])].sort();
    for (const dep of deps) {
      if (!byId.has(dep)) continue; // unknown deps are blockers, not cycles
      if (color.get(dep) === GRAY) {
        const cycle = stack.slice(stack.indexOf(dep)).concat(dep);
        const members = [...new Set(cycle)].sort();
        fail(CODES.CYCLE_DETECTED, `Dependency cycle detected: ${members.join(" -> ")}`, {
          cycle: members,
        });
      }
      if (color.get(dep) === WHITE) visit(dep);
    }
    stack.pop();
    color.set(id, BLACK);
  }

  for (const item of [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (color.get(item.id) === WHITE) visit(item.id);
  }
}

export function projectQueue({ obligations, now, trustedAuthorizations = [] }) {
  const nowMs = utcIsoToMs(now, "now");
  const items = (obligations || []).map((o) => ({
    id: o.id,
    kind: o.kind,
    filedAt: o.filedAt,
    filedAtMs: utcIsoToMs(o.filedAt, `filedAt for ${o.id}`),
    state: o.state,
    deps: [...(o.deps || [])],
    repingSent: !!o.repingSent,
    reportSent: !!o.reportSent,
    override: validateOverride(o.id, o.override ?? null, { trustedAuthorizations }),
  }));

  detectCycle(items);

  const byId = new Map(items.map((i) => [i.id, i]));
  const open = items.filter((i) => !TERMINAL_STATES.has(i.state));

  // Blocked = any dependency is unresolved (unknown id) or not CLOSED.
  function blockingDeps(item) {
    const blocking = [];
    for (const dep of item.deps) {
      const target = byId.get(dep);
      if (!target || target.state !== "CLOSED") blocking.push(dep);
    }
    return [...new Set(blocking)].sort();
  }

  // Effective filed time: if item A is blocked on B, B inherits the earliest
  // effective filed time from every transitively blocked descendant. Computed
  // over the reverse adjacency (dependents -> dependency) in reverse
  // topological order, so each item sees its already-finalized dependents.
  // The inherited age affects ordering only; it never mutates filedAt.
  const byIdOpen = new Map(open.map((i) => [i.id, i]));
  const blockedOn = new Map(open.map((i) => [i.id, []]));
  for (const y of open) {
    for (const dep of y.deps) {
      if (blockedOn.has(dep)) blockedOn.get(dep).push(y.id);
    }
  }
  const topoVisited = new Set();
  const topo = [];
  function visitTopo(id) {
    if (topoVisited.has(id)) return;
    topoVisited.add(id);
    const node = byIdOpen.get(id);
    for (const dep of [...node.deps].sort()) {
      if (byIdOpen.has(dep)) visitTopo(dep);
    }
    topo.push(id); // dependencies land before their dependents
  }
  for (const item of [...open].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    visitTopo(item.id);
  }
  const effCache = new Map();
  for (let i = topo.length - 1; i >= 0; i--) {
    const id = topo[i];
    const node = byIdOpen.get(id);
    let earliest = node.filedAtMs;
    for (const dependentId of blockedOn.get(id)) {
      const depEff = effCache.get(dependentId);
      if (depEff < earliest) earliest = depEff;
    }
    effCache.set(id, earliest);
  }
  function effectiveFiledMs(item) {
    return effCache.get(item.id);
  }

  const blocked = [];
  const actionable = [];
  for (const item of open) {
    const blockers = blockingDeps(item);
    const effMs = effectiveFiledMs(item);
    const entry = { id: item.id, kind: item.kind, effectiveFiledAtMs: effMs };
    if (blockers.length > 0) {
      blocked.push({ ...entry, blockedBy: blockers, reason: `waiting on ${blockers.join(", ")}` });
    } else {
      actionable.push(entry);
    }
  }

  const ageMsOf = (effMs) => nowMs - effMs;
  // Oldest effective age first; obligation_id is the stable tie-breaker.
  const byEffectiveAgeThenId = (a, b) =>
    a.effectiveFiledAtMs - b.effectiveFiledAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  // Overrides reorder: override rank, override time (by instant, not lexical
  // string order), effective age, then id. Non-overridden items keep plain
  // oldest-first order and always sort after overridden ones.
  const overridden = [];
  const plain = [];
  for (const entry of actionable) {
    const ov = byId.get(entry.id).override;
    if (ov) overridden.push({ ...entry, override: ov });
    else plain.push(entry);
  }
  overridden.sort((a, b) => {
    if (a.override.rank !== b.override.rank) return a.override.rank - b.override.rank;
    if (a.override.recordedAtMs !== b.override.recordedAtMs) {
      return a.override.recordedAtMs - b.override.recordedAtMs;
    }
    return byEffectiveAgeThenId(a, b);
  });
  plain.sort(byEffectiveAgeThenId);
  const ordered = [...overridden, ...plain];

  blocked.sort(byEffectiveAgeThenId);
  // Deterministic order for the actionable list as well (oldest first, id tie-break).
  actionable.sort(byEffectiveAgeThenId);

  // Oldest open item (actionable or blocked) by effective age.
  let oldest = null;
  let oldestAgeMs = null;
  const allOpen = [...blocked, ...actionable].sort(byEffectiveAgeThenId);
  if (allOpen.length > 0) {
    const first = allOpen[0];
    oldest = { id: first.id, kind: first.kind };
    oldestAgeMs = ageMsOf(first.effectiveFiledAtMs);
  }

  // No-starvation escalations. Strictly greater than four hours starts the
  // chain; exactly four hours is pinned to "no action due".
  const escalations = [];
  for (const entry of allOpen) {
    const item = byId.get(entry.id);
    const ageMs = ageMsOf(entry.effectiveFiledAtMs);
    if (ageMs > FOUR_HOURS_MS) {
      if (!item.repingSent) escalations.push({ id: item.id, action: "REPING_DUE", ageMs });
      else if (!item.reportSent) escalations.push({ id: item.id, action: "REPORT_TO_JASON_DUE", ageMs });
    }
  }
  escalations.sort((a, b) => b.ageMs - a.ageMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    ordered: ordered.map((e) => e.id),
    actionable: actionable.map((e) => e.id),
    blocked: blocked.map((e) => ({ id: e.id, blockedBy: e.blockedBy, reason: e.reason })),
    oldest,
    oldestAgeMs,
    escalations,
    overrides: overridden.map((e) => ({
      id: e.id,
      actor: e.override.actor,
      recordedAt: e.override.recordedAt,
      reason: e.override.reason,
      authorityRef: e.override.authorityRef,
      rank: e.override.rank,
    })),
  };
}
