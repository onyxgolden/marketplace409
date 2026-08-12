import {
  execFileSync,
} from "node:child_process";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  afterEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  executeProgrammerCommand,
} from "./executeProgrammerCommand";

const currentFilePath = fileURLToPath(import.meta.url);

const sourceRepositoryRoot = path.resolve(
  path.dirname(currentFilePath),
  "../../..",
);

const temporaryRepositories = new Set();

function copyDirectoryRecursive(source, destination) {
  if (!fs.existsSync(source)) {
    return;
  }

  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function copyFile(relativePath, repositoryRoot) {
  const sourcePath = path.join(sourceRepositoryRoot, relativePath);

  if (!fs.existsSync(sourcePath)) {
    return;
  }

  const destinationPath = path.join(repositoryRoot, relativePath);

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function git(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const DIRECTORIES_TO_COPY = [
  "scripts/governance",
  "scripts/conversation",
  "scripts/orchestration",
  "docs/architecture",
  "governance/config",
  "governance/policies",
  "governance/schema",
  "governance/specifications",
  "governance/templates",
];

const FILES_TO_COPY = [
  "governance/state/current-governance-state.json",
  "governance/state/promotion-state.json",
];

function createFixtureRepository() {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "forge-executor-real-collector-"),
  );

  temporaryRepositories.add(repositoryRoot);

  for (const relativeDirectory of DIRECTORIES_TO_COPY) {
    copyDirectoryRecursive(
      path.join(sourceRepositoryRoot, relativeDirectory),
      path.join(repositoryRoot, relativeDirectory),
    );
  }

  for (const relativeFile of FILES_TO_COPY) {
    copyFile(relativeFile, repositoryRoot);
  }

  fs.mkdirSync(path.join(repositoryRoot, "governance/snapshots"), {
    recursive: true,
  });

  const copiedStatePath = path.join(
    repositoryRoot,
    "governance/state/current-governance-state.json",
  );

  if (fs.existsSync(copiedStatePath)) {
    const state = JSON.parse(
      fs.readFileSync(copiedStatePath, "utf8"),
    );

    if (state.session?.latestSnapshot) {
      copyFile(state.session.latestSnapshot, repositoryRoot);
    }
  }

  fs.mkdirSync(path.join(repositoryRoot, "governance/validation"), {
    recursive: true,
  });

  fs.writeFileSync(
    path.join(repositoryRoot, ".gitignore"),
    "/governance/validation/*.json\n/governance/validation/*.tmp\n",
    "utf8",
  );

  git(repositoryRoot, ["init", "-b", "main"]);
  git(repositoryRoot, ["config", "user.name", "FORGE Executor Test"]);
  git(repositoryRoot, [
    "config",
    "user.email",
    "forge-executor@example.invalid",
  ]);
  git(repositoryRoot, ["add", "."]);
  git(repositoryRoot, ["commit", "-m", "Fixture commit"]);
  git(repositoryRoot, [
    "update-ref",
    "refs/remotes/origin/main",
    "HEAD",
  ]);

  return repositoryRoot;
}

function writeValidationArtifact(repositoryRoot, head) {
  const repositoryState = {
    branch: "main",
    head,
    originMain: head,
    headMatchesOriginMain: true,
    workingTreeClean: true,
    gitStatus: [],
  };

  const artifact = {
    schemaVersion: "1.0",
    validationId: "forge-validation-20260811-000000",
    capturedAt: "2026-08-11T00:00:04.000Z",
    startedAt: "2026-08-11T00:00:00.000Z",
    completedAt: "2026-08-11T00:00:03.000Z",
    repository: {
      before: repositoryState,
      after: repositoryState,
    },
    commands: [
      {
        category: "focusedTests",
        command: "npx",
        args: ["vitest", "run"],
        workingDirectory: ".",
        startedAt: "2026-08-11T00:00:00.000Z",
        completedAt: "2026-08-11T00:00:01.000Z",
        exitCode: 0,
        status: "passing",
        summary: "Focused tests passed.",
      },
      {
        category: "fullTests",
        command: "npx",
        args: ["vitest", "run"],
        workingDirectory: ".",
        startedAt: "2026-08-11T00:00:01.000Z",
        completedAt: "2026-08-11T00:00:02.000Z",
        exitCode: 0,
        status: "passing",
        summary: "Full tests passed.",
      },
      {
        category: "productionBuild",
        command: "npm",
        args: ["run", "build"],
        workingDirectory: ".",
        startedAt: "2026-08-11T00:00:02.000Z",
        completedAt: "2026-08-11T00:00:03.000Z",
        exitCode: 0,
        status: "passing",
        summary: "Production build passed.",
      },
    ],
    results: {
      focusedTests: {
        status: "passing",
        commandIndexes: [0],
        summary: "Focused tests passed.",
      },
      fullTests: {
        status: "passing",
        commandIndexes: [1],
        summary: "Full tests passed.",
      },
      productionBuild: {
        status: "passing",
        commandIndexes: [2],
        summary: "Production build passed.",
      },
    },
  };

  fs.writeFileSync(
    path.join(
      repositoryRoot,
      "governance/validation/forge-validation-20260811-000000.json",
    ),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
}

function listSnapshots(repositoryRoot) {
  const snapshotDirectory = path.join(
    repositoryRoot,
    "governance/snapshots",
  );

  return fs
    .readdirSync(snapshotDirectory)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function readSnapshot(repositoryRoot, name) {
  return JSON.parse(
    fs.readFileSync(
      path.join(repositoryRoot, "governance/snapshots", name),
      "utf8",
    ),
  );
}

function readSyncedState(repositoryRoot) {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        repositoryRoot,
        "governance/state/current-governance-state.json",
      ),
      "utf8",
    ),
  );
}

function readSyncedDocument(repositoryRoot, relativePath) {
  return fs.readFileSync(
    path.join(repositoryRoot, relativePath),
    "utf8",
  );
}

/**
 * Runs the real "prepare-next-session" command end to end: a real,
 * non-mocked spawnSync chain through
 * scripts/orchestration/runEngineeringConversationSession.mjs ->
 * runEngineeringSession -> runGovernancePipeline ->
 * executeShadowGovernanceTransaction -> collectSessionEvidence.mjs, inside
 * an isolated git fixture repository.
 */
function runPrepareNextSession(reviewedMetadata, repositoryRoot) {
  const resolvedRepositoryRoot =
    repositoryRoot ?? createFixtureRepository();

  const head = git(resolvedRepositoryRoot, ["rev-parse", "HEAD"]);

  writeValidationArtifact(resolvedRepositoryRoot, head);

  const baselineSnapshots = listSnapshots(resolvedRepositoryRoot);

  const result = executeProgrammerCommand({
    commandId: "prepare-next-session",
    repositoryRoot: resolvedRepositoryRoot,
    ...(reviewedMetadata ? { reviewedMetadata } : {}),
  });

  const newSnapshots = listSnapshots(resolvedRepositoryRoot).filter(
    (name) => !baselineSnapshots.includes(name),
  );

  return {
    repositoryRoot: resolvedRepositoryRoot,
    result,
    newSnapshots,
  };
}

afterEach(() => {
  for (const repositoryRoot of temporaryRepositories) {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }

  temporaryRepositories.clear();
});

describe(
  "executeProgrammerCommand real collector integration",
  () => {
    test(
      "collects evidence exactly once; the single reviewed snapshot drives the synced governance state, the synchronized documents, and the generated bootstrap",
      () => {
        const { repositoryRoot, result, newSnapshots } =
          runPrepareNextSession({
            phaseIdentifier: "16.9",
            phaseTitle: "Reviewed closeout proposal",
            startingObjective:
              "Fix the duplicate-collection governance bug.",
            endingObjective:
              "Ship the deterministic closeout proposal workflow.",
            deliveredWork: [
              "Eliminated the duplicate session-evidence collection.",
              "Threaded reviewedMetadataPath into the single collector.",
            ],
            knownWarnings: [
              "Legacy claimed warning remains pre-existing.",
            ],
            markSessionComplete: true,
            nextSessionObjective:
              "Visually verify the populated proposal in the dashboard.",
            nextSessionStartingInspection:
              "Review the synchronized documents for the reviewed objective.",
          });

        // ----- Exactly one collection -----
        expect(
          newSnapshots,
          `Expected exactly one new snapshot; found ${JSON.stringify(newSnapshots)}`,
        ).toHaveLength(1);

        const snapshot = readSnapshot(
          repositoryRoot,
          newSnapshots[0],
        );

        // ----- The one snapshot carries the reviewed values -----
        expect(snapshot.phase.identifier).toBe("16.9");
        expect(snapshot.phase.title).toBe(
          "Reviewed closeout proposal",
        );
        expect(snapshot.objective.startingObjective).toBe(
          "Fix the duplicate-collection governance bug.",
        );
        expect(snapshot.objective.endingObjective).toBe(
          "Ship the deterministic closeout proposal workflow.",
        );
        expect(snapshot.work.delivered).toEqual([
          "Eliminated the duplicate session-evidence collection.",
          "Threaded reviewedMetadataPath into the single collector.",
        ]);
        expect(snapshot.work.knownWarnings).toEqual([
          "Legacy claimed warning remains pre-existing.",
        ]);
        expect(snapshot.nextSession.objective).toBe(
          "Visually verify the populated proposal in the dashboard.",
        );
        expect(snapshot.nextSession.startingInspection).toBe(
          "Review the synchronized documents for the reviewed objective.",
        );

        // ----- current-governance-state.json points to that exact snapshot -----
        const syncedState = readSyncedState(repositoryRoot);
        const expectedSnapshotPath = `governance/snapshots/${newSnapshots[0]}`;

        expect(syncedState.session.latestSnapshot).toBe(
          expectedSnapshotPath,
        );
        expect(syncedState.synchronization.sourceSnapshot).toBe(
          expectedSnapshotPath,
        );
        expect(syncedState.state.activePhase.identifier).toBe(
          "16.9",
        );
        expect(syncedState.state.nextSession.objective).toBe(
          "Visually verify the populated proposal in the dashboard.",
        );

        // ----- Synchronized documents reflect the reviewed values, not REVIEW_REQUIRED -----
        const syncedStatusDocument = readSyncedDocument(
          repositoryRoot,
          "docs/architecture/synchronized/FORGE_SYNC_STATUS.md",
        );

        expect(syncedStatusDocument).toContain(
          "Ship the deterministic closeout proposal workflow.",
        );
        expect(syncedStatusDocument).not.toContain(
          "REVIEW_REQUIRED",
        );

        // ----- The generated bootstrap reads the same reviewed values -----
        // generateConversationBootstrap's default writeOutputFn is
        // console.log, and runEngineeringConversationSession.mjs's CLI
        // block explicitly passes writeOutputFn: console.log, so the full
        // rendered bootstrap is present in this step's captured stdout.
        const finalStepOutput = result.steps.at(-1).output;

        expect(finalStepOutput).toContain(
          "Active phase: 16.9 — Reviewed closeout proposal",
        );
        expect(finalStepOutput).toContain(
          "Current objective: Ship the deterministic closeout proposal workflow.",
        );
        expect(finalStepOutput).toContain(
          "Next objective: Visually verify the populated proposal in the dashboard.",
        );

        // ----- The command reports the truth: it actually worked -----
        expect(result.status, JSON.stringify(result, null, 2)).toBe(
          "passing",
        );
      },
      30000,
    );

    test(
      "fails the command when a review-required command runs without reviewed metadata, while the script layer still produces one valid REVIEW_REQUIRED snapshot",
      () => {
        const { repositoryRoot, result, newSnapshots } =
          runPrepareNextSession(null);

        // Requirement: commands without reviewed metadata still produce
        // one valid REVIEW_REQUIRED snapshot at the script/pipeline layer.
        expect(newSnapshots).toHaveLength(1);

        const snapshot = readSnapshot(
          repositoryRoot,
          newSnapshots[0],
        );

        expect(snapshot.phase.identifier).toBe("REVIEW_REQUIRED");

        const syncedState = readSyncedState(repositoryRoot);

        expect(syncedState.state.activePhase.identifier).toBe(
          "REVIEW_REQUIRED",
        );

        // Requirement: the review-required DASHBOARD command must still
        // fail, because metadata was absent.
        expect(result.status, JSON.stringify(result, null, 2)).toBe(
          "failing",
        );

        expect(result.steps.at(-1).output).toContain(
          "FORGE INVARIANT VIOLATION",
        );

        expect(result.steps.at(-1).output).toContain(
          "No reviewed metadata was supplied",
        );
      },
      30000,
    );

    test(
      "repeated collections against the same repository each allocate a unique snapshot, never overwriting the previous one",
      () => {
        const firstRun = runPrepareNextSession({
          phaseIdentifier: "16.9",
          phaseTitle: "First reviewed run",
          endingObjective: "First reviewed run.",
          nextSessionObjective: "Continue past the first run.",
          nextSessionStartingInspection:
            "Review the first run's snapshot.",
        });

        expect(
          firstRun.result.status,
          JSON.stringify(firstRun.result, null, 2),
        ).toBe("passing");
        expect(firstRun.newSnapshots).toHaveLength(1);

        const secondRun = runPrepareNextSession(
          {
            phaseIdentifier: "16.10",
            phaseTitle: "Second reviewed run",
            endingObjective: "Second reviewed run.",
            nextSessionObjective: "Continue past the second run.",
            nextSessionStartingInspection:
              "Review the second run's snapshot.",
          },
          firstRun.repositoryRoot,
        );

        expect(
          secondRun.result.status,
          JSON.stringify(secondRun.result, null, 2),
        ).toBe("passing");
        expect(secondRun.newSnapshots).toHaveLength(1);

        expect(secondRun.newSnapshots[0]).not.toBe(
          firstRun.newSnapshots[0],
        );

        // The first run's snapshot still exists, unmodified, under its
        // original name -- the second collection never overwrote it.
        const firstSnapshot = readSnapshot(
          firstRun.repositoryRoot,
          firstRun.newSnapshots[0],
        );

        expect(firstSnapshot.objective.endingObjective).toBe(
          "First reviewed run.",
        );

        const secondSnapshot = readSnapshot(
          secondRun.repositoryRoot,
          secondRun.newSnapshots[0],
        );

        expect(secondSnapshot.objective.endingObjective).toBe(
          "Second reviewed run.",
        );

        // The synced state now reflects the LATEST (second) run.
        const syncedState = readSyncedState(
          secondRun.repositoryRoot,
        );

        expect(syncedState.state.activePhase.identifier).toBe(
          "16.10",
        );
        expect(syncedState.session.latestSnapshot).toBe(
          `governance/snapshots/${secondRun.newSnapshots[0]}`,
        );
      },
      60000,
    );
  },
);
