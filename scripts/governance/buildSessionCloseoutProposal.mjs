import {
  execFileSync,
} from "node:child_process";

import fs from "node:fs";
import path from "node:path";

import {
  loadGovernanceState,
} from "./loadGovernanceState.mjs";

import {
  buildSessionValidationEvidence,
} from "./buildSessionValidationEvidence.mjs";

const REVIEW_REQUIRED = "REVIEW_REQUIRED";

const MAX_STARTING_INSPECTION_LENGTH = 1800;

/**
 * How far back a trustworthy checkpoint (a session snapshot or the
 * current governance state) may be from HEAD and still be used to anchor
 * the delivered-work range. Deliberately larger than
 * RECOVERY_WINDOW_COMMITS -- a single legitimate work session can
 * reasonably span dozens of commits -- but still bounded, so a checkpoint
 * from weeks ago is never blindly trusted just because it happens to be
 * an ancestor of HEAD.
 */
const MAX_SESSION_WINDOW_COMMITS = 40;

/** Hard cap on commits included when no trustworthy checkpoint exists. */
const RECOVERY_WINDOW_COMMITS = 12;

/** How far back to scan when hunting for the dominant recent scope. */
const RECOVERY_LOOKBACK_LIMIT = 60;

/** How many most-recent snapshot files to inspect before giving up. */
const MAX_SNAPSHOTS_TO_SCAN = 20;

/** "Current feature" scopes -- see requirement B. */
const FEATURE_SCOPE_ALLOWLIST = Object.freeze([
  "developer",
  "governance",
  "forge",
]);

const CONVENTIONAL_COMMIT_PATTERN =
  /^(\w+)\(([^)]+)\):\s*(.+)$/;

const DEFAULT_STARTING_OBJECTIVE_FALLBACK =
  "No prior objective on record for this session.";

const DEFAULT_ENDING_OBJECTIVE_FALLBACK =
  "No delivered work detected for this session yet.";

const DEFAULT_NEXT_OBJECTIVE_FALLBACK =
  "Inspect and prioritize the next FORGE roadmap objective.";

const DEFAULT_NEXT_INSPECTION_FALLBACK =
  "Verify repository synchronization, confirm the latest governance snapshot/state, and inspect files related to the proposed next objective.";

const CURRENT_OBJECTIVE_SECTION_PATTERN =
  /<!-- FORGE:SYNC:current_objective:START -->([\s\S]*?)<!-- FORGE:SYNC:current_objective:END -->/;

function runGit(repositoryRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return null;
    }

    throw error;
  }
}

function parseStatusLines(output) {
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

/**
 * A small, self-contained equivalent of
 * runEngineeringSession.mjs's inspectEngineeringRepository(). Deliberately
 * not imported from that module: doing so pulls the whole engineering
 * session pipeline (promotion evaluation, evolution decisions, shadow
 * governance) into this read-only proposal builder's bundle for the sake
 * of a handful of git values.
 */
function inspectRepository({ repositoryRoot }) {
  const branch = runGit(repositoryRoot, [
    "branch",
    "--show-current",
  ]);

  const head = runGit(repositoryRoot, ["rev-parse", "HEAD"]);

  const originMain = runGit(repositoryRoot, [
    "rev-parse",
    "origin/main",
  ]);

  const statusLines = parseStatusLines(
    runGit(repositoryRoot, ["status", "--short"]),
  );

  return {
    branch,
    head,
    originMain,
    headMatchesOriginMain: head === originMain,
    workingTreeClean: statusLines.length === 0,
    modifiedFiles: statusLines.map((line) =>
      line.length > 3 ? line.slice(3).trim() : line,
    ),
  };
}

function isAncestor(repositoryRoot, candidateHead, currentHead) {
  if (
    !candidateHead ||
    typeof candidateHead !== "string"
  ) {
    return false;
  }

  try {
    execFileSync(
      "git",
      [
        "merge-base",
        "--is-ancestor",
        candidateHead,
        currentHead,
      ],
      {
        cwd: repositoryRoot,
        stdio: "ignore",
      },
    );

    return true;
  } catch {
    return false;
  }
}

function commitDistance(repositoryRoot, fromHead, toHead) {
  const output = runGit(
    repositoryRoot,
    ["rev-list", "--count", `${fromHead}..${toHead}`],
    { allowFailure: true },
  );

  if (output === null) {
    return null;
  }

  const parsed = Number.parseInt(output, 10);

  return Number.isFinite(parsed) ? parsed : null;
}

function parseCommitLogOutput(output) {
  if (!output) {
    return [];
  }

  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf("\x1f");

      return {
        hash:
          separatorIndex === -1
            ? line
            : line.slice(0, separatorIndex),
        subject:
          (separatorIndex === -1
            ? ""
            : line.slice(separatorIndex + 1)
          ).trim(),
      };
    });
}

function listCommitsInRange(repositoryRoot, range) {
  const output = runGit(
    repositoryRoot,
    ["log", "--reverse", "--format=%H%x1f%s", range],
    { allowFailure: true },
  );

  return parseCommitLogOutput(output);
}

/** Most recent first -- the natural order of `git log -N`. */
function listRecentCommits(repositoryRoot, count) {
  const output = runGit(
    repositoryRoot,
    ["log", `-${count}`, "--format=%H%x1f%s"],
    { allowFailure: true },
  );

  return parseCommitLogOutput(output);
}

function countAllAncestors(repositoryRoot, head) {
  const output = runGit(
    repositoryRoot,
    ["rev-list", "--count", head],
    { allowFailure: true },
  );

  const parsed = output === null ? null : Number.parseInt(output, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

function extractScope(subject) {
  const match = subject.match(CONVENTIONAL_COMMIT_PATTERN);
  return match ? match[2] : null;
}

function stripConventionalPrefix(subject) {
  const match = subject.match(CONVENTIONAL_COMMIT_PATTERN);
  return match ? match[3] : subject;
}

function findDominantScope(commits) {
  const counts = new Map();

  for (const commit of commits) {
    const scope = extractScope(commit.subject);

    if (!scope) {
      continue;
    }

    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }

  let dominantScope = null;
  let highestCount = 0;

  for (const [scope, count] of counts) {
    if (count > highestCount) {
      highestCount = count;
      dominantScope = scope;
    }
  }

  return dominantScope;
}

function dedupePreservingOrder(values) {
  return [...new Set(values)];
}

function humanizeScope(scope) {
  if (!scope) {
    return null;
  }

  return scope
    .split(/[-_]/)
    .filter(Boolean)
    .map(
      (part) =>
        part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}…`;
}

function truncateForTitle(subject) {
  return truncate(subject, 80);
}

function toCompactDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}${month}${day}`;
}

/**
 * A checkpoint's phase/objective/next-session metadata is only usable if
 * every field is present and none is REVIEW_REQUIRED -- an ancestral,
 * in-window checkpoint that was itself never reviewed is a fine anchor for
 * the commit range, but not a source of trustworthy text.
 */
function extractTrustworthyMetadata({
  phaseIdentifier,
  phaseTitle,
  nextObjective,
  nextInspection,
}) {
  const isUsable = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    value !== REVIEW_REQUIRED;

  if (
    !isUsable(phaseIdentifier) ||
    !isUsable(phaseTitle) ||
    !isUsable(nextObjective)
  ) {
    return null;
  }

  return {
    phaseIdentifier,
    phaseTitle,
    objectiveText: nextObjective,
    nextInspection: isUsable(nextInspection)
      ? nextInspection
      : null,
  };
}

function listSnapshotFileNames(repositoryRoot) {
  const snapshotDirectory = path.join(
    repositoryRoot,
    "governance",
    "snapshots",
  );

  if (!fs.existsSync(snapshotDirectory)) {
    return [];
  }

  return fs
    .readdirSync(snapshotDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
}

function readSnapshotSafely(repositoryRoot, name) {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(repositoryRoot, "governance", "snapshots", name),
        "utf8",
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Implements requirement A: choose the closest trustworthy prior
 * checkpoint, in priority order, never trusting an ancient governance
 * checkpoint just because it happens to be an ancestor of HEAD.
 */
function selectBaseline({
  repositoryRoot,
  currentHead,
  governanceState,
}) {
  // Tier 1: most recent snapshot that is both an ancestor of HEAD and
  // within the session window. A snapshot qualifies as an ANCHOR even if
  // its own phase/objective are REVIEW_REQUIRED -- metadata usability is
  // evaluated separately below.
  for (const name of listSnapshotFileNames(repositoryRoot).slice(
    0,
    MAX_SNAPSHOTS_TO_SCAN,
  )) {
    const snapshot = readSnapshotSafely(repositoryRoot, name);
    const head = snapshot?.repository?.head;

    if (!isAncestor(repositoryRoot, head, currentHead)) {
      continue;
    }

    const distance = commitDistance(
      repositoryRoot,
      head,
      currentHead,
    );

    if (
      distance === null ||
      distance > MAX_SESSION_WINDOW_COMMITS
    ) {
      continue;
    }

    return {
      tier: "snapshot",
      previousHead: head,
      distance,
      metadata: extractTrustworthyMetadata({
        phaseIdentifier: snapshot?.phase?.identifier,
        phaseTitle: snapshot?.phase?.title,
        nextObjective: snapshot?.nextSession?.objective,
        nextInspection:
          snapshot?.nextSession?.startingInspection,
      }),
    };
  }

  // Tier 2: current governance state, only if it is an ancestor, within
  // the session window, AND its own phase/objective are already reviewed.
  const stateHead = governanceState?.repository?.head;

  if (isAncestor(repositoryRoot, stateHead, currentHead)) {
    const distance = commitDistance(
      repositoryRoot,
      stateHead,
      currentHead,
    );

    const metadata = extractTrustworthyMetadata({
      phaseIdentifier:
        governanceState?.state?.activePhase?.identifier,
      phaseTitle: governanceState?.state?.activePhase?.title,
      nextObjective:
        governanceState?.state?.nextSession?.objective,
      nextInspection:
        governanceState?.state?.nextSession
          ?.startingInspection,
    });

    if (
      distance !== null &&
      distance <= MAX_SESSION_WINDOW_COMMITS &&
      metadata !== null
    ) {
      return {
        tier: "governanceState",
        previousHead: stateHead,
        distance,
        metadata,
      };
    }
  }

  // Tier 3: no trustworthy checkpoint -- bounded recovery.
  return {
    tier: "recovery",
    previousHead: null,
    distance: null,
    metadata: null,
  };
}

/** Tier 1/2: the full (already bounded) range since a trustworthy anchor. */
function selectAnchoredCommits({
  repositoryRoot,
  previousHead,
  currentHead,
}) {
  const commits = listCommitsInRange(
    repositoryRoot,
    `${previousHead}..${currentHead}`,
  );

  return {
    commits,
    excludedCommitCount: 0,
    dominantScope: findDominantScope(commits),
  };
}

/**
 * Tier 3: implements requirement B. Scans a bounded lookback window and
 * prefers commits in the current-feature scope allowlist over everything
 * else -- NOT whichever scope has the highest raw count. A large volume of
 * old, unrelated history (e.g. 55 decision-intelligence commits) must
 * never outvote a handful of recent developer/governance/forge commits;
 * only when the lookback contains no allowlisted-scope commits at all does
 * this fall back to clustering on whatever scope is actually dominant.
 */
function selectRecoveryCommits({ repositoryRoot, currentHead }) {
  const lookback = listRecentCommits(
    repositoryRoot,
    RECOVERY_LOOKBACK_LIMIT,
  );

  if (lookback.length === 0) {
    return {
      commits: [],
      excludedCommitCount: 0,
      dominantScope: null,
    };
  }

  const featureScopedCommits = lookback.filter((commit) =>
    FEATURE_SCOPE_ALLOWLIST.includes(extractScope(commit.subject)),
  );

  const matching =
    featureScopedCommits.length > 0
      ? featureScopedCommits
      : lookback;

  const dominantScope = findDominantScope(matching);

  const cluster = matching.slice(0, RECOVERY_WINDOW_COMMITS);

  const totalAncestors = countAllAncestors(
    repositoryRoot,
    currentHead,
  );

  const excludedCommitCount = Math.max(
    0,
    totalAncestors - cluster.length,
  );

  return {
    commits: [...cluster].reverse(),
    excludedCommitCount,
    dominantScope,
  };
}

function extractCurrentObjectiveFromRoadmapStatus(
  repositoryRoot,
  roadmapStatusDocumentPath,
) {
  const resolvedPath = path.resolve(
    /* turbopackIgnore: true */
    repositoryRoot,
    roadmapStatusDocumentPath,
  );

  if (!fs.existsSync(resolvedPath)) {
    return null;
  }

  const content = fs.readFileSync(resolvedPath, "utf8");
  const match = content.match(CURRENT_OBJECTIVE_SECTION_PATTERN);

  if (!match) {
    return null;
  }

  const sectionBody = match[1]
    .replace(/^\s*##\s*Immediate Objective\s*$/m, "")
    .trim();

  if (
    !sectionBody ||
    sectionBody === "REVIEW_REQUIRED." ||
    sectionBody === "REVIEW_REQUIRED"
  ) {
    return null;
  }

  return sectionBody;
}

/**
 * Intentionally mirrors the completion-eligibility check in
 * collectSessionEvidence.mjs's resolveCompletion(): evidence must cover the
 * current commit and every validation category must be "passing". Kept as a
 * read-only proposal signal here -- the collector remains the sole writer of
 * actual completion state.
 */
function evaluateCompletionEligibility({
  selectedArtifact,
  validation,
  head,
}) {
  const evidenceCoversCurrentCommit =
    selectedArtifact !== null &&
    selectedArtifact.repositoryHead === head;

  const validationAllPassing =
    validation.focusedTests.status === "passing" &&
    validation.fullTests.status === "passing" &&
    validation.productionBuild.status === "passing";

  return evidenceCoversCurrentCommit && validationAllPassing;
}

export function buildSessionCloseoutProposal({
  repositoryRoot = process.cwd(),
  governanceStatePath = "governance/state/current-governance-state.json",
  roadmapStatusDocumentPath = "docs/architecture/synchronized/FORGE_SYNC_STATUS.md",
  loadGovernanceStateFn = loadGovernanceState,
  inspectRepositoryFn = inspectRepository,
  buildSessionValidationEvidenceFn = buildSessionValidationEvidence,
  now = new Date(),
} = {}) {
  const normalizedRoot = path.resolve(
    /* turbopackIgnore: true */
    repositoryRoot,
  );

  let governanceState = null;

  try {
    governanceState = loadGovernanceStateFn(governanceStatePath, {
      repositoryRoot: normalizedRoot,
    });
  } catch {
    governanceState = null;
  }

  const repository = inspectRepositoryFn({
    repositoryRoot: normalizedRoot,
  });

  const sessionValidationEvidence = buildSessionValidationEvidenceFn({
    repositoryRoot: normalizedRoot,
  });

  const baseline = selectBaseline({
    repositoryRoot: normalizedRoot,
    currentHead: repository.head,
    governanceState,
  });

  const recoveryMode = baseline.tier === "recovery";

  const {
    commits,
    excludedCommitCount,
    dominantScope,
  } = recoveryMode
    ? selectRecoveryCommits({
        repositoryRoot: normalizedRoot,
        currentHead: repository.head,
      })
    : selectAnchoredCommits({
        repositoryRoot: normalizedRoot,
        previousHead: baseline.previousHead,
        currentHead: repository.head,
      });

  const deliveredWork = dedupePreservingOrder(
    commits.map((commit) => commit.subject),
  );

  // The synchronized roadmap doc is itself downstream of the same
  // governance-state staleness problem, so it is only trusted when the
  // baseline checkpoint driving this proposal is trustworthy in the first
  // place -- otherwise a stale doc would silently reintroduce exactly the
  // defect this rewrite fixes.
  const roadmapObjective = !recoveryMode
    ? extractCurrentObjectiveFromRoadmapStatus(
        normalizedRoot,
        roadmapStatusDocumentPath,
      )
    : null;

  const phaseIsFallback = baseline.metadata === null;

  const phase = baseline.metadata
    ? {
        identifier: baseline.metadata.phaseIdentifier,
        title: baseline.metadata.phaseTitle,
      }
    : {
        identifier: `session-${toCompactDate(now)}-${
          repository.head
            ? repository.head.slice(0, 7)
            : "unknown"
        }`,
        title: dominantScope
          ? `${humanizeScope(dominantScope)} session work`
          : commits.length > 0
            ? truncateForTitle(
                stripConventionalPrefix(
                  commits[commits.length - 1].subject,
                ),
              )
            : "Recent repository work",
      };

  const objectiveIsFallback = baseline.metadata === null;

  const carriedObjective =
    baseline.metadata?.objectiveText ?? null;

  const startingObjective = objectiveIsFallback
    ? commits.length > 0
      ? `Continue from: ${truncate(
          stripConventionalPrefix(commits[0].subject),
          200,
        )}`
      : DEFAULT_STARTING_OBJECTIVE_FALLBACK
    : carriedObjective;

  const endingObjective = objectiveIsFallback
    ? commits.length > 0
      ? `Ship: ${truncate(
          stripConventionalPrefix(
            commits[commits.length - 1].subject,
          ),
          200,
        )}`
      : DEFAULT_ENDING_OBJECTIVE_FALLBACK
    : roadmapObjective || carriedObjective;

  const nextObjectiveIsFallback = objectiveIsFallback;

  const nextSessionObjective = nextObjectiveIsFallback
    ? DEFAULT_NEXT_OBJECTIVE_FALLBACK
    : endingObjective;

  const nextInspectionIsFallback =
    baseline.metadata?.nextInspection === null ||
    baseline.metadata?.nextInspection === undefined;

  const nextSessionStartingInspection = nextInspectionIsFallback
    ? DEFAULT_NEXT_INSPECTION_FALLBACK
    : baseline.metadata.nextInspection;

  const completionEligible = evaluateCompletionEligibility({
    selectedArtifact: sessionValidationEvidence.selectedArtifact,
    validation: sessionValidationEvidence.validation,
    head: repository.head,
  });

  return {
    generatedFrom: {
      governanceStateFound: governanceState !== null,
      baselineTier: baseline.tier,
      previousHead: baseline.previousHead,
      currentHead: repository.head,
      distanceFromBaseline: baseline.distance,
      recoveryMode,
      excludedCommitCount,
      dominantScope,
      roadmapObjectiveFound: roadmapObjective !== null,
    },
    fallbackApplied: {
      phase: phaseIsFallback,
      objective: objectiveIsFallback,
      nextObjective: nextObjectiveIsFallback,
      nextInspection: nextInspectionIsFallback,
    },
    phase,
    objective: {
      startingObjective,
      endingObjective,
    },
    deliveredWork,
    deliveredWorkTotalInRange: commits.length,
    changedFiles: repository.modifiedFiles ?? [],
    knownWarnings: [],
    validation: sessionValidationEvidence.validation,
    // This command runs full validation itself before collecting the
    // reviewed snapshot, so any evidence found here predates that run --
    // hasCurrentValidationArtifact tells the UI whether to show that stale
    // evidence's real status or a "Pending closeout" placeholder.
    hasCurrentValidationArtifact:
      sessionValidationEvidence.selectedArtifact !== null,
    completion: {
      eligible: completionEligible,
      // Always request completion by default: the collector re-runs
      // validation live and applies its own evidence gate (see
      // resolveCompletion in collectSessionEvidence.mjs), so this proposal
      // never needs to pre-judge whether that run will pass.
      proposedMarkSessionComplete: true,
    },
    nextSession: {
      objective: nextSessionObjective,
      startingInspection: truncate(
        nextSessionStartingInspection,
        MAX_STARTING_INSPECTION_LENGTH,
      ),
    },
    repository: {
      head: repository.head,
      branch: repository.branch,
      workingTreeClean: repository.workingTreeClean,
      headMatchesOriginMain: repository.headMatchesOriginMain,
    },
  };
}
