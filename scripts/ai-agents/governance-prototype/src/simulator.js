/**
 * simulator.js — consumption-time revalidation simulator (host-owned).
 *
 * Separate from the agent: on a simulated consumption step it
 * independently resolves the current target head, policy registrations /
 * versions, principal grants, revocations, current verdict and agreement
 * from the (possibly mutated) fixture context, then re-evaluates from
 * current fixture state. It never returns "authorized" because an old
 * JSON result said ALLOWED: gate_sufficient is true only when a fresh
 * evaluation independently reaches GROUNDED ALLOWED and the fixture
 * state is unchanged since the advisory.
 *
 * The simulator performs no action; execution_performed is always false.
 */

import { run } from "./index.js";

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

const canon = (v) => JSON.stringify(sortKeys(v));

function byId(arr, idFn) {
  return Object.fromEntries(arr.map((x) => [idFn(x), x]));
}

function diffMaps(before, after, changePrefix, describe) {
  const changes = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of [...keys].sort()) {
    if (canon(before[k]) !== canon(after[k])) {
      changes.push({ change_id: `${changePrefix}:${k}`, description: describe(k, before[k], after[k]) });
    }
  }
  return changes;
}

/** Stable change list between the advisory-time and consumption-time fixture state. */
export function diffChanges(task, contextBefore, contextAfter) {
  const changes = [];
  if (contextBefore.clock !== contextAfter.clock) {
    changes.push({ change_id: "chg:clock", description: "evaluation clock moved between advisory and consumption" });
  }
  const tkey = `${task.target.repo}|${task.target.resource_id}`;
  const hb = contextBefore.heads.find((h) => `${h.repo}|${h.resource_id}` === tkey);
  const ha = contextAfter.heads.find((h) => `${h.repo}|${h.resource_id}` === tkey);
  if (canon(hb) !== canon(ha)) {
    changes.push({ change_id: "chg:head", description: "registered target head changed between advisory and consumption" });
  }
  changes.push(
    ...diffMaps(
      byId(contextBefore.policies, (p) => `${p.policy_id}@${p.version}`),
      byId(contextAfter.policies, (p) => `${p.policy_id}@${p.version}`),
      "chg:policy",
      (k) => `policy content/registration binding changed for ${k}`
    )
  );
  const rb = byId(contextBefore.registrations, (r) => r.record_id);
  const ra = byId(contextAfter.registrations, (r) => r.record_id);
  if (canon(rb) !== canon(ra)) {
    changes.push({ change_id: "chg:registration", description: "policy registration set changed between advisory and consumption" });
  }
  const vb = byId(contextBefore.verdicts, (v) => v.verdict_id);
  const va = byId(contextAfter.verdicts, (v) => v.verdict_id);
  if (canon(vb) !== canon(va)) {
    changes.push({ change_id: "chg:verdict", description: "reviewer verdict set changed between advisory and consumption" });
  }
  const ab = byId(contextBefore.agreements, (a) => a.agreement_id);
  const aa = byId(contextAfter.agreements, (a) => a.agreement_id);
  if (canon(ab) !== canon(aa)) {
    changes.push({ change_id: "chg:agreement", description: "agreement set changed between advisory and consumption" });
  }
  const lb = byId(contextBefore.relays, (r) => r.relay_id);
  const la = byId(contextAfter.relays, (r) => r.relay_id);
  if (canon(lb) !== canon(la)) {
    changes.push({ change_id: "chg:relay", description: "relay set changed between advisory and consumption" });
  }
  const pb = byId(contextBefore.principals, (p) => p.principal_id);
  const pa = byId(contextAfter.principals, (p) => p.principal_id);
  if (canon(pb) !== canon(pa)) {
    changes.push({ change_id: "chg:principal", description: "principal set changed between advisory and consumption" });
  }
  const bb = byId(Object.entries(contextBefore.blobs).map(([k, v]) => ({ key: k, content: v.content })), (x) => x.key);
  const ba = byId(Object.entries(contextAfter.blobs).map(([k, v]) => ({ key: k, content: v.content })), (x) => x.key);
  if (canon(bb) !== canon(ba)) {
    changes.push({ change_id: "chg:blob", description: "fixture source bytes changed between advisory and consumption" });
  }
  return changes.sort((a, b) => (a.change_id < b.change_id ? -1 : a.change_id > b.change_id ? 1 : 0));
}

/**
 * Re-evaluate a prior advisory result against current fixture context.
 * Returns {gate_sufficient, execution_performed:false, changes, required_reevaluation}.
 */
export function reevaluate(task, initialResult, contextBefore, contextAfter) {
  const fresh = run(task, contextAfter);
  const changes = diffChanges(task, contextBefore, contextAfter);
  const freshAllowed =
    fresh.status === "CLASSIFIED" &&
    fresh.validity === "GROUNDED" &&
    fresh.classification === "ALLOWED" &&
    fresh.complete === true;
  const initialWasAllowed =
    initialResult &&
    initialResult.status === "CLASSIFIED" &&
    initialResult.validity === "GROUNDED" &&
    initialResult.classification === "ALLOWED";
  const gate_sufficient = initialWasAllowed && freshAllowed && changes.length === 0;
  return {
    gate_sufficient,
    execution_performed: false,
    changes,
    required_reevaluation: !gate_sufficient,
    fresh_classification: fresh.classification,
    fresh_status: fresh.status,
    fresh_validity: fresh.validity,
  };
}
