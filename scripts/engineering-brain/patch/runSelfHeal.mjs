/**
 * runSelfHeal.mjs — Slice 8: end-to-end self-heal driver.
 *
 * Composes the earlier slices into one deterministic run: a nightly evidence
 * signal goes in, a verified fix PR comes out, with no human hands in between.
 * The driver adds no new capability — it runs diagnose (Slice 6 rerank) ->
 * propose (Slices 3/4) -> fix-PR (Slice 7) in order, carries one fail-closed
 * report through them, and stops at the first refusal.
 *
 * Safety contract (enforced, not aspirational):
 * - The driver NEVER merges, deploys, or writes production data. The merge
 *   endpoint does not appear in this file. A human (or reviewer agent) merges
 *   through the normal review flow.
 * - One signal -> at most one PR per run. No sweeping the whole evidence file.
 * - PR/commit text carries evidence provenance only; the driver passes no
 *   free text into the fix-PR context (the Slice 7 summary-leak fix holds).
 * - Network steps (push, open PR) sit behind injectable deps so tests stay
 *   hermetic. No model calls anywhere.
 */

import path from "node:path";

import { loadManifest } from "../query/loadManifest.mjs";
import { createCachedGitReader } from "../query/createCachedGitReader.mjs";
import { readFileAtCommit, readMigrationsAtCommit } from "../gitRepository.mjs";
import {
  loadCollectedEvidenceFile,
  selectEvidenceSignal,
} from "../query/loadCollectedEvidence.mjs";
import { loadBugCatalogRecords } from "../query/queryEngineeringBrainCli.mjs";
import { assembleDiagnosticContext } from "../query/assembleDiagnosticContext.mjs";
import { proposePatch, buildPathIndex } from "./proposePatch.mjs";
import { prepareFixPr } from "./prepareFixPr.mjs";

const DEFAULT_MANIFEST_RELPATH = path.join("engineering-brain", "index-manifest.json");

const fail = (stage, reason, extra = {}) => ({ ok: false, stage, reason, ...extra });
const errDetail = (e) => String((e && e.message) || e).slice(0, 300);

/**
 * Default diagnose: the --diagnose path of the query CLI (including the
 * Slice 6 evidence rerank), pointed at the driver's repoRoot.
 */
function defaultDiagnose({ evidencePath, signalId, repoRoot, manifestPath }) {
  const manifest = loadManifest(manifestPath);
  const cachedReader = createCachedGitReader({
    readFileAtCommit: (commitSha, sourcePath) => readFileAtCommit(commitSha, sourcePath, repoRoot),
    readMigrationsAtCommit: (commitSha) => readMigrationsAtCommit(commitSha, repoRoot),
  });
  const { signals } = loadCollectedEvidenceFile(evidencePath);
  const evidenceSignal = selectEvidenceSignal(signals, signalId);
  const bugRecords = loadBugCatalogRecords({ manifestPath, bugCatalogPath: null });
  const bundle = assembleDiagnosticContext({
    manifest,
    queryText: "",
    filters: {},
    excerptReader: cachedReader,
    contentProvider: (commitSha, sourcePath) => cachedReader.readFileAtCommit(commitSha, sourcePath),
    bugRecords,
    evidenceSignal,
  });
  return { bundle, evidenceSignal };
}

/** Default propose: build the path index, then run the narrow-rules proposer. */
function defaultPropose({ bundle, evidenceSignal, repoRoot }) {
  const pathIndex = buildPathIndex({ repoRoot, bundle });
  const result = proposePatch({ bundle, evidence: evidenceSignal, repoRoot, pathIndex });
  // proposePatch wraps: { patch, explanation } — unwrap like the fix-PR CLI does.
  return result && result.patch ? result.patch : result;
}

/**
 * Run the full self-heal pipeline for one evidence signal:
 * diagnose -> propose -> fix-PR.
 *
 * Returns { ok:true, signalId, baseCommit, branch, pr, verification } on
 * success, or { ok:false, stage, reason[, detail] } with the failing link
 * named ("diagnose" | "propose" | "fix-pr/<stage>"). A proposer clean stop
 * (noPatch / manual application) is a report, not an error — nothing is
 * half-created.
 */
export function runSelfHeal({
  evidencePath,
  signalId,
  repoRoot,
  baseCommit,
  manifestPath,
  deps = {},
}) {
  const diagnose = deps.diagnose || defaultDiagnose;
  const propose = deps.propose || defaultPropose;
  const fixPr =
    deps.fixPr ||
    (({ patch, context }) => prepareFixPr({ patch, repoRoot, baseCommit, context, deps }));

  // --- validate ---
  if (!evidencePath || !repoRoot || !baseCommit) {
    return fail("validate", "missing-context", { signalId: signalId || null });
  }
  const resolvedManifest =
    manifestPath || path.join(repoRoot, DEFAULT_MANIFEST_RELPATH);

  // --- diagnose ---
  let diagnosed;
  try {
    diagnosed = diagnose({
      evidencePath,
      signalId,
      repoRoot,
      manifestPath: resolvedManifest,
    });
  } catch (e) {
    return fail("diagnose", "diagnose-threw", {
      signalId: signalId || null,
      baseCommit,
      detail: errDetail(e),
    });
  }
  const bundle = diagnosed && diagnosed.bundle;
  const evidenceSignal = diagnosed && diagnosed.evidenceSignal;
  if (!bundle || !evidenceSignal) {
    return fail("diagnose", "diagnose-empty", { signalId: signalId || null, baseCommit });
  }
  const resolvedSignalId = evidenceSignal.signal_id || signalId;

  // --- propose ---
  let patch;
  try {
    patch = propose({ bundle, evidenceSignal, repoRoot });
  } catch (e) {
    return fail("propose", "propose-threw", {
      signalId: resolvedSignalId,
      baseCommit,
      detail: errDetail(e),
    });
  }
  if (!patch || patch.noPatch) {
    return fail("propose", (patch && patch.reason) || "no-patch", {
      signalId: resolvedSignalId,
      baseCommit,
    });
  }
  if (patch.application === "manual") {
    return fail("propose", "manual-application", {
      signalId: resolvedSignalId,
      baseCommit,
    });
  }

  // --- fix PR (Slice 7 owns this link's safety case) ---
  const context = {
    signalId: resolvedSignalId,
    failedStep: evidenceSignal.failed_step,
    collectedAt: evidenceSignal.collected_at,
  };
  let result;
  try {
    result = fixPr({ patch, repoRoot, baseCommit, context });
  } catch (e) {
    return fail("fix-pr", "fix-pr-threw", {
      signalId: resolvedSignalId,
      baseCommit,
      detail: errDetail(e),
    });
  }
  if (!result || !result.ok) {
    return fail(`fix-pr/${(result && result.stage) || "unknown"}`, (result && result.reason) || "fix-pr-failed", {
      signalId: resolvedSignalId,
      baseCommit,
      ...(result && result.detail ? { detail: String(result.detail).slice(0, 300) } : {}),
    });
  }

  return {
    ok: true,
    signalId: resolvedSignalId,
    baseCommit,
    branch: result.branch,
    pr: { number: result.pr.number, url: result.pr.url },
    verification: result.verification,
  };
}
