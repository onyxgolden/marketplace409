/**
 * generators.mjs — deterministic narrow candidate generators + replay adapter.
 * Pure module: no fs, no child_process, no network. The "candidate agent":
 * it may READ the verified snapshot and PROPOSE a plan + unified diff, and
 * nothing else. All enforcement lives in the host-side evaluator.
 */

import { createHash } from "node:crypto";
import { REASON, FAMILIES, PROFILES, OPERATIONS } from "./constants.mjs";
import { validateTargetPath, validateNewParent, normalizePath } from "./paths.mjs";
import { renderDiff, parseUnifiedDiff } from "./diff.mjs";

export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function allowedTarget(task, path) {
  const c = task.constraints;
  const inAllowed = c.allowed_paths.some((a) => {
    const na = normalizePath(a);
    return path === na || path.startsWith(na + "/");
  });
  if (!inAllowed) return false;
  const inForbidden = c.forbidden_paths.some((f) => {
    const nf = normalizePath(f);
    return path === nf || path.startsWith(nf + "/");
  });
  return !inForbidden;
}

function basePlan(task, targetFiles, profileIds) {
  return {
    target_files: targetFiles,
    steps: [
      "read verified snapshot (budgeted)",
      "emit bounded proposal (plan + unified diff)",
      "host validates plan, patch, budgets and authorization",
      "host applies once to a fresh disposable copy",
      "host runs fixed profiles in OS-enforced isolation",
      "host packages advisory evidence and cleans up",
    ],
    test_profile_ids: profileIds,
    risk_notes: [
      "advisory proposal only; never deployment or merge authorization",
      "candidate code executes solely inside the host isolation sandbox",
    ],
    rollback_sketch: "disposable copy is destroyed; fixture base is immutable",
  };
}

function evidenceFor(task, path, fileEntry, span) {
  return [
    {
      kind: "snapshot",
      repo_id: task.fixture_ref.repo_id,
      base_commit: task.fixture_ref.base_commit,
      path,
      blob_sha256: fileEntry ? fileEntry.sha256 : null,
      span,
    },
  ];
}

/** Shared anchor-replace core for the two correction families. */
function anchorReplace({ task, snapshot, bad, good, singleLine }) {
  const fail = (status, reason_codes, detail) => ({ ok: false, status, reason_codes, detail });
  const p = task.task.params || {};
  const rawPath = p.path;
  if (typeof rawPath !== "string") return fail("BLOCKED", [REASON.AMBIGUOUS_TASK], "params.path-missing");
  const existingLower = new Set([...snapshot.files.keys()].map((k) => k.toLowerCase()));
  const vp = validateTargetPath(rawPath, existingLower);
  if (!vp.ok) {
    const st = vp.reason === REASON.ORACLE_TAMPER ? "REFUSED" : "BLOCKED";
    return fail(st, [vp.reason], vp.detail);
  }
  const path = vp.path;
  if (!allowedTarget(task, path)) return fail("BLOCKED", [REASON.PATH_REJECTED], "outside-allowed-paths");
  if (!snapshot.files.has(path)) return fail("BLOCKED", [REASON.PATCH_NOT_APPLICABLE], "path-not-in-snapshot");
  if (typeof bad !== "string" || bad.length === 0 || typeof good !== "string") {
    return fail("BLOCKED", [REASON.AMBIGUOUS_TASK], "bad/good-not-strings");
  }
  if (singleLine && (bad.includes("\n") || good.includes("\n"))) {
    return fail("BLOCKED", [REASON.AMBIGUOUS_TASK], "boundary-fix-must-be-single-expression");
  }
  const entry = snapshot.files.get(path);
  const content = entry.content;
  const first = content.indexOf(bad);
  if (first < 0) return fail("BLOCKED", [REASON.NO_UNIQUE_ANCHOR], "anchor-not-found");
  if (content.indexOf(bad, first + 1) >= 0) {
    return fail("BLOCKED", [REASON.NO_UNIQUE_ANCHOR], "anchor-not-unique");
  }
  const newContent = content.slice(0, first) + good + content.slice(first + bad.length);
  if (newContent === content) return fail("BLOCKED", [REASON.NO_CHANGE_NEEDED], "identical");
  const lineNo = content.slice(0, first).split("\n").length;
  const diff = renderDiff(path, "modify", content, newContent);
  if (!diff) return fail("BLOCKED", [REASON.NO_CHANGE_NEEDED], "identical");
  return {
    ok: true,
    path,
    operation: OPERATIONS.MODIFY,
    baseContent: content,
    newContent,
    diff,
    evidence: evidenceFor(task, path, entry, `line ${lineNo}`),
  };
}

function finalize(task, path, operation, baseEntry, diff, evidence, profileIds) {
  const parsed = parseUnifiedDiff(diff);
  if (!parsed.ok) return { ok: false, status: "BLOCKED", reason_codes: [parsed.reason], detail: parsed.detail };
  return {
    ok: true,
    plan: basePlan(
      task,
      [{ path, operation, base_blob_or_null: baseEntry ? baseEntry.sha256 : null }],
      profileIds,
    ),
    proposed_diff: diff,
    proposal_sha256: sha256(diff),
    evidence_refs: evidence,
  };
}

export function generateLiteralCorrection(task, snapshot) {
  const p = task.task.params || {};
  const r = anchorReplace({ task, snapshot, bad: p.bad || p.bad_literal, good: p.good || p.good_literal, singleLine: false });
  if (!r.ok) return r;
  if (!task.constraints.allowed_operations.includes(OPERATIONS.MODIFY)) {
    return { ok: false, status: "BLOCKED", reason_codes: [REASON.OPERATION_FORBIDDEN], detail: "modify-not-allowed" };
  }
  return finalize(task, r.path, r.operation, snapshot.files.get(r.path), r.diff, r.evidence, [
    PROFILES.SYNTAX,
    PROFILES.BASELINE,
    PROFILES.CANDIDATE,
  ]);
}

export function generateBoundaryCorrection(task, snapshot) {
  const p = task.task.params || {};
  const r = anchorReplace({ task, snapshot, bad: p.bad || p.bad_expr, good: p.good || p.good_expr, singleLine: true });
  if (!r.ok) return r;
  if (!task.constraints.allowed_operations.includes(OPERATIONS.MODIFY)) {
    return { ok: false, status: "BLOCKED", reason_codes: [REASON.OPERATION_FORBIDDEN], detail: "modify-not-allowed" };
  }
  return finalize(task, r.path, r.operation, snapshot.files.get(r.path), r.diff, r.evidence, [
    PROFILES.SYNTAX,
    PROFILES.BASELINE,
    PROFILES.CANDIDATE,
  ]);
}

// Static purity deny-list for helper sources (heuristic; the syntax profile
// and the pure-serialization oracle are the enforcement gates).
const IMPURE_RES = [
  /\bimport\b/,
  /\brequire\s*\(/,
  /\bprocess\./,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
  /\bchild_process\b/,
  /\bfs\b/,
  /\bnet\b/,
  /\bhttp\b/,
  /\bfetch\s*\(/,
  /\bWebSocket\b/,
  /\bglobalThis\s*\.\s*[A-Za-z_$][\w$]*\s*=/,
  /\bDeno\b/,
  /\bconsole\.(log|error|warn|debug)\b/,
];

export function checkHelperPurity(source, exportName) {
  if (typeof source !== "string" || source.length === 0 || source.length > 8192) {
    return { ok: false, detail: "helper-size" };
  }
  const lines = source.split("\n");
  if (lines.length > 200) return { ok: false, detail: "helper-too-many-lines" };
  for (const re of IMPURE_RES) {
    const m = source.match(re);
    if (m) return { ok: false, detail: `impure:${m[0].slice(0, 40)}` };
  }
  const exportRe = new RegExp(`export\\s+(function|const)\\s+${exportName}\\b|export\\s*\\{[^}]*\\b${exportName}\\b[^}]*\\}`);
  if (!exportRe.test(source)) return { ok: false, detail: "export-name-missing" };
  return { ok: true };
}

export function generateAddHelper(task, snapshot) {
  const fail = (status, reason_codes, detail) => ({ ok: false, status, reason_codes, detail });
  const p = task.task.params || {};
  if (!task.constraints.allowed_operations.includes(OPERATIONS.ADD)) {
    return fail("BLOCKED", [REASON.OPERATION_FORBIDDEN], "add-not-allowed");
  }
  const existingDirsLower = new Set(
    [...snapshot.files.keys()].map((k) => {
      const i = k.lastIndexOf("/");
      return i > 0 ? k.slice(0, i).toLowerCase() : "";
    }),
  );
  const safeParents = ["lib"];
  const vp = validateNewParent(p.parent_dir, existingDirsLower, safeParents);
  if (!vp.ok) return fail("BLOCKED", [vp.reason], vp.detail);
  const fileName = typeof p.filename === "string" ? p.filename : "";
  if (!/^[A-Za-z][\w.-]*\.mjs$/.test(fileName)) {
    return fail("BLOCKED", [REASON.PATH_REJECTED], "filename-shape");
  }
  const fullPath = `${vp.path}/${fileName}`;
  const existingLower = new Set([...snapshot.files.keys()].map((k) => k.toLowerCase()));
  const vt = validateTargetPath(fullPath, existingLower);
  if (!vt.ok) {
    const st = vt.reason === REASON.ORACLE_TAMPER ? "REFUSED" : "BLOCKED";
    return fail(st, [vt.reason], vt.detail);
  }
  if (snapshot.files.has(vt.path)) return fail("BLOCKED", [REASON.PATCH_NOT_APPLICABLE], "add-over-existing");
  if (!allowedTarget(task, vt.path)) return fail("BLOCKED", [REASON.PATH_REJECTED], "outside-allowed-paths");
  const purity = checkHelperPurity(p.helper_source, p.export_name);
  if (!purity.ok) return fail("REFUSED", [REASON.OPERATION_FORBIDDEN], purity.detail);
  const src = p.helper_source.endsWith("\n") ? p.helper_source : p.helper_source + "\n";
  const diff = renderDiff(vt.path, "add", null, src);
  return finalize(task, vt.path, OPERATIONS.ADD, null, diff, evidenceFor(task, vt.path, null, "new-file"), [
    PROFILES.SYNTAX,
    PROFILES.BASELINE,
    PROFILES.CANDIDATE,
  ]);
}

/**
 * Replay adapter: accept a frozen candidate diff for adversarial evaluation.
 * Verifies the digest, parses the diff, and returns it as the candidate
 * without generation. Never invents content.
 */
export function replayCandidate(task) {
  const fail = (status, reason_codes, detail) => ({ ok: false, status, reason_codes, detail });
  const cr = task.candidate_ref;
  if (!cr || cr.kind !== "replay") return fail("BLOCKED", [REASON.TASK_MALFORMED], "no-replay-candidate");
  if (sha256(cr.diff) !== cr.diff_sha256) {
    return fail("BLOCKED", [REASON.PATCH_STALE], "replay-digest-mismatch");
  }
  const parsed = parseUnifiedDiff(cr.diff);
  if (!parsed.ok) {
    const st = parsed.reason === REASON.OPERATION_FORBIDDEN ? "REFUSED" : "BLOCKED";
    return fail(st, [parsed.reason], parsed.detail);
  }
  const targets = parsed.files.map((f) => ({
    path: f.path,
    operation: f.operation,
    base_blob_or_null: null, // resolved by the plan validator against the snapshot
  }));
  return {
    ok: true,
    plan: basePlan(task, targets, [PROFILES.SYNTAX, PROFILES.BASELINE, PROFILES.CANDIDATE]),
    proposed_diff: cr.diff,
    proposal_sha256: cr.diff_sha256,
    evidence_refs: [{ kind: "replay", diff_sha256: cr.diff_sha256 }],
    replay: true,
  };
}

/** Dispatch to the family generator, or the replay adapter when present. */
export function generateCandidate(task, snapshot) {
  if (task.candidate_ref) return replayCandidate(task);
  switch (task.task.family) {
    case FAMILIES.LITERAL_CORRECTION:
      return generateLiteralCorrection(task, snapshot);
    case FAMILIES.BOUNDARY_CORRECTION:
      return generateBoundaryCorrection(task, snapshot);
    case FAMILIES.ADD_HELPER:
      return generateAddHelper(task, snapshot);
    default:
      return { ok: false, status: "BLOCKED", reason_codes: [REASON.FAMILY_UNSUPPORTED], detail: task.task.family };
  }
}
