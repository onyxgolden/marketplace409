/**
 * plan-validator.mjs — validate a candidate plan + unified diff against the
 * task constraints, trusted authorization, budgets and the verified snapshot.
 * Host-side. Pure (no I/O) given the snapshot.
 */

import { REASON, OPERATIONS } from "./constants.mjs";
import { validateTargetPath, validateNewParent, normalizePath } from "./paths.mjs";
import { parseUnifiedDiff, diffStats, applyDiffExact } from "./diff.mjs";
import { validateProfileIds } from "./task-schema.mjs";

/** Hostile-capability tripwire over frozen diff text (host-observed). */
const CAPABILITY_RES = [
  /\bchild_process\b/,
  /\brequire\s*\(\s*["'](fs|child_process|net|os|v8|vm|worker_threads|cluster|dgram|dns|tls|inspector)["']/,
  /\bfrom\s+["']node:/,
  /\bfrom\s+["']fs["']/,
  /\bprocess\.\s*(env|exit|kill|dlopen|binding)\b/,
  /\bfetch\s*\(/,
  /\bWebSocket\b/,
  /\bXMLHttpRequest\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
];
const RESOURCE_RES = [/\bwhile\s*\(\s*true\s*\)/, /\bfor\s*\(\s*;\s*;\s*\)/];

export function scanHostileDiff(diffText) {
  const capabilityHits = [];
  const resourceHits = [];
  for (const re of CAPABILITY_RES) {
    const m = diffText.match(re);
    if (m) capabilityHits.push(m[0].slice(0, 60));
  }
  for (const re of RESOURCE_RES) {
    const m = diffText.match(re);
    if (m) resourceHits.push(m[0].slice(0, 60));
  }
  return { capabilityHits, resourceHits };
}

function inScope(task, path) {
  const c = task.constraints;
  const na = (p) => normalizePath(p);
  const allowed = c.allowed_paths.some((a) => {
    const x = na(a);
    return path === x || path.startsWith(x + "/");
  });
  if (!allowed) return false;
  return !c.forbidden_paths.some((f) => {
    const x = na(f);
    return path === x || path.startsWith(x + "/");
  });
}

/**
 * Validate plan + diff. Returns { ok:true, parsed, stats, hostileHits } or
 * { ok:false, status, reason_codes, detail }.
 */
export function validatePlan({ task, plan, proposedDiff, snapshot, trusted }) {
  const fail = (status, reason_codes, detail) => ({ ok: false, status, reason_codes, detail });

  // Profile IDs: fixed registry only, and within the trusted allowlist.
  const pv = validateProfileIds(plan.test_profile_ids);
  if (!pv.ok) return fail("REFUSED", [pv.reason], pv.detail);
  for (const id of plan.test_profile_ids) {
    if (!trusted.allowed_profile_ids.includes(id)) {
      return fail("REFUSED", [REASON.PROFILE_TAMPER], `profile-not-authorized:${id}`);
    }
  }

  // Diff parses and is within budgets.
  const parsed = parseUnifiedDiff(proposedDiff);
  if (!parsed.ok) {
    // Out-of-scope operations (delete/rename/binary/mode) are REFUSED;
    // malformed patches are BLOCKED.
    const st = parsed.reason === REASON.OPERATION_FORBIDDEN ? "REFUSED" : "BLOCKED";
    return fail(st, [parsed.reason], parsed.detail);
  }
  const stats = diffStats(parsed);
  const over = { checkPatch: null };
  {
    const b = trusted.budgets;
    if (stats.files > b.maxTargetFiles) return fail("BLOCKED", [REASON.BUDGET_EXCEEDED], `files>${b.maxTargetFiles}`);
    if (stats.addedRemoved > b.maxAddedRemovedLines) {
      return fail("BLOCKED", [REASON.BUDGET_EXCEEDED], `lines>${b.maxAddedRemovedLines}`);
    }
    if (Buffer.byteLength(proposedDiff, "utf8") > b.maxPatchBytes) {
      return fail("BLOCKED", [REASON.BUDGET_EXCEEDED], `patch>${b.maxPatchBytes}B`);
    }
  }
  void over;

  // Target files: path policy, scope, operations, base-blob binding.
  const existingLower = new Set([...snapshot.files.keys()].map((k) => k.toLowerCase()));
  const existingDirsLower = new Set(
    [...snapshot.files.keys()].map((k) => {
      const i = k.lastIndexOf("/");
      return i > 0 ? k.slice(0, i).toLowerCase() : "";
    }),
  );
  for (const f of parsed.files) {
    const vt = validateTargetPath(f.path, existingLower);
    if (!vt.ok) {
      const st = vt.reason === REASON.ORACLE_TAMPER ? "REFUSED" : "BLOCKED";
      return fail(st, [vt.reason], vt.detail);
    }
    if (!inScope(task, vt.path)) return fail("BLOCKED", [REASON.PATH_REJECTED], "outside-task-scope");
    if (!task.constraints.allowed_operations.includes(f.operation)) {
      return fail("BLOCKED", [REASON.OPERATION_FORBIDDEN], `op-not-allowed:${f.operation}`);
    }
    if (f.operation === OPERATIONS.MODIFY) {
      if (!snapshot.files.has(vt.path)) return fail("BLOCKED", [REASON.PATCH_NOT_APPLICABLE], `not-in-snapshot:${vt.path}`);
      const entry = snapshot.files.get(vt.path);
      const planEntry = (plan.target_files || []).find((t) => normalizePath(t.path) === vt.path);
      if (planEntry && planEntry.base_blob_or_null && planEntry.base_blob_or_null !== entry.sha256) {
        return fail("BLOCKED", [REASON.PATCH_STALE], `stale-base:${vt.path}`);
      }
    } else {
      // add: safe existing parent required
      if (snapshot.files.has(vt.path)) return fail("BLOCKED", [REASON.PATCH_NOT_APPLICABLE], `add-over-existing:${vt.path}`);
      const dir = vt.path.slice(0, vt.path.lastIndexOf("/"));
      const vp = validateNewParent(dir, existingDirsLower, ["lib"]);
      if (!vp.ok) return fail("BLOCKED", [vp.reason], vp.detail);
    }
  }

  // Dry-run apply: all-or-nothing against the verified snapshot.
  const contentMap = new Map([...snapshot.files.entries()].map(([p, e]) => [p, e.content]));
  const applied = applyDiffExact(parsed, contentMap);
  if (!applied.ok) return fail("BLOCKED", [applied.reason], applied.detail);
  let changed = false;
  for (const [p, content] of applied.files) {
    const before = snapshot.files.get(p);
    if (!before || before.content !== content) changed = true;
  }
  if (!changed) return fail("BLOCKED", [REASON.NO_CHANGE_NEEDED], "diff-is-no-op");

  const hostileHits = scanHostileDiff(proposedDiff);
  return { ok: true, parsed, stats, hostileHits };
}
