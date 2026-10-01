#!/usr/bin/env node
/**
 * runDocDriftCli.mjs — Slice 10 CLI: detect doc drift, propose narrow fixes.
 *
 *   node scripts/engineering-brain/docs/runDocDriftCli.mjs --repo <root>
 *     [--docs <dir> ...] [--apply] [--max-fixes <n>] [--base <sha>]
 *     [--dry-run] [--json]
 *
 * Without --apply: scans docs, reports every finding and whether a
 * deterministic fix is proposable. Read-only; exit 0 unless the scan itself
 * fails.
 *
 * With --apply: takes the first --max-fixes (default 1) proposable patches
 * and runs each through the reviewed prepareFixPr pipeline (branch + PR;
 * never merge). --base (full commit SHA) is required with --apply.
 * --dry-run refuses --apply and only reports.
 *
 * Exit codes: 0 scan/report ok (findings are not failures); 1 scan or
 * apply failure; 2 bad usage.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectDocDrift,
  listDocFiles,
} from "./detectDocDrift.mjs";
import { proposeDocFix, isDocRewriteTarget } from "./proposeDocFix.mjs";
import { pathExistsInRepo } from "../patch/proposePatch.mjs";
import { prepareFixPr } from "../patch/prepareFixPr.mjs";

function usage() {
  return [
    "usage: runDocDriftCli.mjs --repo <root> [--docs <dir> ...] [--apply]",
    "         [--max-fixes <n>] [--base <sha>] [--dry-run] [--json]",
  ].join("\n");
}

export function parseArgs(argv) {
  const out = { docs: ["docs"], apply: false, maxFixes: 1, dryRun: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--repo") out.repo = argv[++i];
    else if (a === "--docs") { out.docs = []; while (argv[i + 1] && !argv[i + 1].startsWith("--")) out.docs.push(argv[++i]); }
    else if (a === "--apply") out.apply = true;
    else if (a === "--max-fixes") out.maxFixes = parseInt(argv[++i], 10);
    else if (a === "--base") out.base = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else { out.bad = a; break; }
  }
  return out;
}

function gitLsFiles(repoRoot) {
  const out = execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

/**
 * Case-exact existence check. pathExistsInRepo lowercases (it was built for
 * case-noisy CI logs); doc literals are usually written in the file's exact
 * case, so an exact hit means "not dead" even when the lowercased form
 * misses on a case-sensitive filesystem.
 */
export function pathExistsExact(repoRoot, p) {
  const cut = String(p).search(/[*?[]/);
  const check = (cut === -1 ? String(p) : String(p).slice(0, cut)).replace(/\/+$/, "");
  if (!check) return false;
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, check);
  if (abs !== root && !abs.startsWith(root + path.sep)) return false;
  return fs.existsSync(abs);
}

function countBackticks(s) {
  const m = String(s).match(/`/g);
  return m ? m.length : 0;
}

/**
 * Doc-aware apply+verify for prepareFixPr: fresh worktree at baseCommit,
 * staleness check against patch.original, markdown sanity (non-empty,
 * backtick parity, docs-only target), then write. Returns
 * { applied: true, worktree, verification } or { applied: false, reason }.
 * The worktree is kept on success (prepareFixPr commits from it).
 */
export function applyDocPatch({ patch, repoRoot, baseCommit }) {
  if (!patch || patch.noPatch) return { applied: false, reason: "no-patch" };
  if (!isDocRewriteTarget(patch.path)) return { applied: false, reason: "not-a-doc-target" };
  const dir = fs.mkdtempSync(path.join(os.homedir(), ".brain-doc-apply-"));
  const cleanup = () => {
    try {
      execFileSync("git", ["worktree", "remove", "--force", dir], { stdio: "pipe" });
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  try {
    execFileSync("git", ["worktree", "add", "--detach", dir, baseCommit], { cwd: repoRoot, stdio: "pipe" });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { applied: false, reason: "worktree-failed", detail: String((e && e.message) || e).slice(0, 200) };
  }
  const abs = path.resolve(dir, patch.path);
  if (abs !== path.resolve(dir) && !abs.startsWith(path.resolve(dir) + path.sep)) {
    cleanup();
    return { applied: false, reason: "path-escape" };
  }
  let current;
  try {
    current = fs.readFileSync(abs, "utf8");
  } catch {
    cleanup();
    return { applied: false, reason: "doc-missing-in-worktree" };
  }
  if (current !== patch.original) {
    cleanup();
    return { applied: false, reason: "stale-doc" };
  }
  if (!patch.patched || countBackticks(patch.patched) !== countBackticks(patch.original)) {
    cleanup();
    return { applied: false, reason: "sanity-failed" };
  }
  fs.writeFileSync(abs, patch.patched, "utf8");
  return {
    applied: true,
    worktree: dir,
    verification: { kind: "doc-drift", repairClass: patch.repairClass, checks: ["stale-ok", "backticks-ok", "docs-only"] },
  };
}

/** Scan + propose. Pure-ish: repo I/O isolated here so tests inject seams. */
export function scanAndPropose({ repoRoot, docs = ["docs"], files = null, scriptNames = null }) {
  const docFiles = files || listDocFiles(repoRoot, docs);
  const scripts =
    scriptNames ||
    JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts ||
    {};
  const scriptList = Array.isArray(scripts) ? scripts : Object.keys(scripts);
  let candidates = null; // lazy: git ls-files
  const docFileSet = new Set(docFiles);
  const report = [];
  for (const docPath of docFiles) {
    const abs = path.join(repoRoot, docPath);
    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const findings = detectDocDrift({
      docPath,
      text,
      pathExists: (p) => pathExistsExact(repoRoot, p) || pathExistsInRepo(repoRoot, p),
      scriptNames: scriptList,
      docFileSet,
    });
    for (const finding of findings) {
      if (candidates === null) {
        try {
          candidates = gitLsFiles(repoRoot);
        } catch {
          candidates = [];
        }
      }
      const { patch, explanation } = proposeDocFix({
        finding,
        docText: text,
        candidates,
        scriptNames: scriptList,
        docFiles,
      });
      report.push({ finding, proposable: !patch.noPatch, reason: patch.noPatch ? patch.reason : null, explanation, patch: patch.noPatch ? null : patch });
    }
  }
  // Deterministic order: doc path, then line.
  report.sort((a, b) =>
    a.finding.docPath < b.finding.docPath ? -1
    : a.finding.docPath > b.finding.docPath ? 1
    : a.finding.line - b.finding.line,
  );
  return report;
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(usage()); return 0; }
  if (args.bad || !args.repo) { console.error(usage()); return 2; }
  if (args.dryRun && args.apply) { console.error("--dry-run refuses --apply"); return 2; }
  if (args.apply && !args.base) { console.error("--apply requires --base <sha>"); return 2; }
  if (!Number.isInteger(args.maxFixes) || args.maxFixes < 1) { console.error("--max-fixes must be a positive int"); return 2; }

  const repoRoot = path.resolve(args.repo);
  let report;
  try {
    report = scanAndPropose({ repoRoot, docs: args.docs });
  } catch (e) {
    console.error(`scan failed: ${String((e && e.message) || e)}`);
    return 1;
  }

  const out = { ok: true, findings: report.length, results: report.map((r) => ({
    driftClass: r.finding.driftClass, docPath: r.finding.docPath, line: r.finding.line,
    literal: r.finding.literal, proposable: r.proposable, reason: r.reason, explanation: r.explanation,
  })) };

  if (!args.apply) {
    if (args.json) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`doc-drift scan: ${report.length} finding(s)`);
      for (const r of out.results) {
        console.log(`- [${r.driftClass}] ${r.docPath}:${r.line} \`${r.literal}\` — ${r.proposable ? r.explanation : `no fix (${r.reason})`}`);
      }
    }
    return 0;
  }

  // --apply: first maxFixes proposable patches go through prepareFixPr.
  const applied = [];
  let failures = 0;
  for (const r of report) {
    if (applied.length >= args.maxFixes) break;
    if (!r.proposable) continue;
    const context = { signalId: `doc-drift/${r.finding.driftClass}/${r.finding.docPath}:${r.finding.line}` };
    let res;
    try {
      res = prepareFixPr({
        patch: r.patch,
        repoRoot,
        baseCommit: args.base,
        context,
        deps: { applyAndVerify: applyDocPatch },
      });
    } catch (e) {
      res = { ok: false, stage: "apply", reason: "apply-threw", detail: String((e && e.message) || e).slice(0, 200) };
    }
    out.results.find((x) => x.docPath === r.finding.docPath && x.line === r.finding.line && x.literal === r.finding.literal).fixPr = res.ok ? { branch: res.branch, pr: res.pr } : { stage: res.stage, reason: res.reason };
    if (res.ok) applied.push(res);
    else failures += 1;
  }
  out.applied = applied.map((a) => ({ branch: a.branch, pr: a.pr }));
  out.failures = failures;
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`doc-drift apply: ${applied.length} PR(s), ${failures} failure(s)`);
    for (const a of applied) console.log(`- ${a.branch} -> PR #${a.pr.number} ${a.pr.url}`);
  }
  return failures > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
