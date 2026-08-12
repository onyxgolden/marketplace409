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
  buildSessionCloseoutProposal,
} from "../buildSessionCloseoutProposal.mjs";

const currentFilePath = fileURLToPath(import.meta.url);

const sourceRepositoryRoot = path.resolve(
  path.dirname(currentFilePath),
  "../../..",
);

const temporaryRepositories = new Set();

function git(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createFixtureRepository() {
  const repositoryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "forge-closeout-proposal-"),
  );

  temporaryRepositories.add(repositoryRoot);

  git(repositoryRoot, ["init", "-b", "main"]);
  git(repositoryRoot, ["config", "user.name", "FORGE Proposal Test"]);
  git(repositoryRoot, [
    "config",
    "user.email",
    "forge-proposal@example.invalid",
  ]);

  fs.writeFileSync(
    path.join(repositoryRoot, ".gitignore"),
    "/governance/validation/*.json\n",
    "utf8",
  );

  git(repositoryRoot, ["add", "--", ".gitignore"]);
  git(repositoryRoot, ["commit", "-m", "Add gitignore"]);

  return repositoryRoot;
}

function commitFile(repositoryRoot, relativePath, contents, message) {
  const absolutePath = path.join(repositoryRoot, relativePath);

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");

  git(repositoryRoot, ["add", "--", relativePath]);
  git(repositoryRoot, ["commit", "-m", message]);

  return git(repositoryRoot, ["rev-parse", "HEAD"]);
}

function setOriginMainToHead(repositoryRoot) {
  git(repositoryRoot, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
}

function writeGovernanceState(repositoryRoot, overrides = {}) {
  const statePath = path.join(
    repositoryRoot,
    "governance/state/current-governance-state.json",
  );

  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  const state = {
    schemaVersion: "1.0",
    repository: {
      branch: "main",
      head: null,
      originMain: null,
      workingTreeClean: true,
      headMatchesOriginMain: true,
    },
    session: {
      latestSnapshot: null,
      lastUpdated: null,
    },
    state: {
      activePhase: {
        identifier: "REVIEW_REQUIRED",
        title: "REVIEW_REQUIRED",
        status: "incomplete",
      },
      currentObjective: "REVIEW_REQUIRED",
      completedWork: [],
      knownWarnings: [],
      nextSession: {
        objective: "REVIEW_REQUIRED",
        startingInspection: "REVIEW_REQUIRED",
      },
    },
    ...overrides,
  };

  fs.writeFileSync(
    statePath,
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

function writeSnapshotFile(repositoryRoot, name, overrides = {}) {
  const snapshotPath = path.join(
    repositoryRoot,
    "governance/snapshots",
    name,
  );

  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });

  const snapshot = {
    schemaVersion: "1.0",
    sessionId: name.replace(/\.json$/, ""),
    repository: {
      branch: "main",
      head: null,
    },
    phase: {
      identifier: "REVIEW_REQUIRED",
      title: "REVIEW_REQUIRED",
    },
    nextSession: {
      objective: "REVIEW_REQUIRED",
      startingInspection: "REVIEW_REQUIRED",
    },
    ...overrides,
  };

  fs.writeFileSync(
    snapshotPath,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
}

function writeRoadmapStatusDocument(repositoryRoot, objectiveText) {
  const documentPath = path.join(
    repositoryRoot,
    "docs/architecture/synchronized/FORGE_SYNC_STATUS.md",
  );

  fs.mkdirSync(path.dirname(documentPath), { recursive: true });

  const content = [
    "# FORGE Synchronizer Status",
    "",
    "<!-- FORGE:SYNC:current_objective:START -->",
    "",
    "## Immediate Objective",
    "",
    `${objectiveText}`,
    "",
    "<!-- FORGE:SYNC:current_objective:END -->",
    "",
  ].join("\n");

  fs.writeFileSync(documentPath, content, "utf8");
}

function copyValidatorScript(repositoryRoot) {
  const relativePath =
    "scripts/governance/validateValidationEvidence.mjs";

  const destination = path.join(repositoryRoot, relativePath);

  fs.mkdirSync(path.dirname(destination), { recursive: true });

  fs.copyFileSync(
    path.join(sourceRepositoryRoot, relativePath),
    destination,
  );

  git(repositoryRoot, ["add", "--", relativePath]);
  git(repositoryRoot, ["commit", "-m", "Add validator script"]);

  return git(repositoryRoot, ["rev-parse", "HEAD"]);
}

function writeValidationArtifact(repositoryRoot, { head, validationId }) {
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
    validationId,
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

  const validationDirectory = path.join(
    repositoryRoot,
    "governance/validation",
  );

  fs.mkdirSync(validationDirectory, { recursive: true });

  fs.writeFileSync(
    path.join(validationDirectory, `${validationId}.json`),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
}

afterEach(() => {
  for (const repositoryRoot of temporaryRepositories) {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }

  temporaryRepositories.clear();
});

describe("buildSessionCloseoutProposal", () => {
  test("rejects a stale governance-state checkpoint whose distance exceeds the session window, falling back to bounded recovery", () => {
    const repositoryRoot = createFixtureRepository();

    const staleHead = commitFile(
      repositoryRoot,
      "base.txt",
      "base",
      "Initial base commit",
    );

    writeGovernanceState(repositoryRoot, {
      repository: {
        branch: "main",
        head: staleHead,
        originMain: staleHead,
        workingTreeClean: true,
        headMatchesOriginMain: true,
      },
      state: {
        activePhase: {
          identifier: "9.1",
          title: "Old stale phase",
          status: "complete",
        },
        currentObjective: "Old stale objective",
        completedWork: [],
        knownWarnings: [],
        nextSession: {
          objective: "Old stale next objective",
          startingInspection: "Old stale inspection",
        },
      },
    });

    for (let index = 0; index < 41; index += 1) {
      commitFile(
        repositoryRoot,
        `drift-${index}.txt`,
        String(index),
        `chore: unrelated drift ${index}`,
      );
    }

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.generatedFrom.baselineTier).toBe("recovery");
    expect(proposal.generatedFrom.recoveryMode).toBe(true);
    expect(proposal.fallbackApplied.phase).toBe(true);
    expect(proposal.phase.identifier).not.toBe("9.1");
    expect(proposal.phase.title).not.toBe("Old stale phase");
    expect(proposal.objective.endingObjective).not.toBe(
      "Old stale objective",
    );
  });

  test("prefers the latest ancestral, in-window snapshot over the current governance state", () => {
    const repositoryRoot = createFixtureRepository();

    const snapshotHead = commitFile(
      repositoryRoot,
      "snapshot-base.txt",
      "a",
      "feat(developer): add snapshot base",
    );

    writeSnapshotFile(
      repositoryRoot,
      "forge-session-20260810-090000000-01.json",
      {
        repository: { branch: "main", head: snapshotHead },
        phase: {
          identifier: "16.9",
          title: "Reviewed closeout proposal",
        },
        nextSession: {
          objective: "Wire dashboard summary UX",
          startingInspection:
            "Check ProgrammerDashboard.jsx for the summary toggle",
        },
      },
    );

    writeGovernanceState(repositoryRoot, {
      repository: {
        branch: "main",
        head: snapshotHead,
        originMain: snapshotHead,
        workingTreeClean: true,
        headMatchesOriginMain: true,
      },
      state: {
        activePhase: {
          identifier: "STALE",
          title: "Stale phase",
          status: "complete",
        },
        currentObjective: "Stale objective",
        completedWork: [],
        knownWarnings: [],
        nextSession: {
          objective: "Stale next objective",
          startingInspection: "Stale inspection",
        },
      },
    });

    commitFile(
      repositoryRoot,
      "delivered.txt",
      "b",
      "feat(developer): wire dashboard summary UX",
    );

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.generatedFrom.baselineTier).toBe("snapshot");
    expect(proposal.deliveredWork).toEqual([
      "feat(developer): wire dashboard summary UX",
    ]);
    expect(proposal.phase).toEqual({
      identifier: "16.9",
      title: "Reviewed closeout proposal",
    });
    expect(proposal.fallbackApplied.phase).toBe(false);
    expect(proposal.objective.endingObjective).toBe(
      "Wire dashboard summary UX",
    );
    expect(proposal.nextSession.objective).toBe(
      "Wire dashboard summary UX",
    );
    expect(proposal.nextSession.startingInspection).toBe(
      "Check ProgrammerDashboard.jsx for the summary toggle",
    );
  });

  test("recovery mode caps delivered work at the bounded recovery window and reports how many older commits were excluded", () => {
    const repositoryRoot = createFixtureRepository();

    for (let index = 0; index < 20; index += 1) {
      commitFile(
        repositoryRoot,
        `work-${index}.txt`,
        String(index),
        `Untracked legacy work ${index}`,
      );
    }

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.generatedFrom.recoveryMode).toBe(true);
    expect(proposal.deliveredWork.length).toBe(12);
    expect(proposal.deliveredWorkTotalInRange).toBe(12);
    expect(proposal.generatedFrom.excludedCommitCount).toBeGreaterThan(0);
  });

  test("never leaves a policy-required field equal to REVIEW_REQUIRED even with an unreviewed governance state and no roadmap objective", () => {
    const repositoryRoot = createFixtureRepository();

    const staleHead = commitFile(
      repositoryRoot,
      "base.txt",
      "a",
      "Initial base commit",
    );

    writeGovernanceState(repositoryRoot, {
      repository: {
        branch: "main",
        head: staleHead,
        originMain: staleHead,
        workingTreeClean: true,
        headMatchesOriginMain: true,
      },
    });

    writeRoadmapStatusDocument(repositoryRoot, "REVIEW_REQUIRED.");

    for (let index = 0; index < 15; index += 1) {
      commitFile(
        repositoryRoot,
        `history-${index}.txt`,
        String(index),
        `fix: unrelated historical fix ${index}`,
      );
    }

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.phase.identifier).not.toBe("REVIEW_REQUIRED");
    expect(proposal.phase.title).not.toBe("REVIEW_REQUIRED");
    expect(proposal.objective.startingObjective).not.toBe(
      "REVIEW_REQUIRED",
    );
    expect(proposal.objective.startingObjective).not.toBeNull();
    expect(proposal.objective.endingObjective).not.toBe(
      "REVIEW_REQUIRED",
    );
    expect(proposal.objective.endingObjective).not.toBeNull();
    expect(proposal.nextSession.objective).not.toBe("REVIEW_REQUIRED");
    expect(proposal.nextSession.startingInspection).not.toBe(
      "REVIEW_REQUIRED",
    );
  });

  test("deduplicates repeated commit subjects within the delivered-work list", () => {
    const repositoryRoot = createFixtureRepository();

    const baseHead = commitFile(
      repositoryRoot,
      "base.txt",
      "a",
      "feat(developer): baseline",
    );

    writeGovernanceState(repositoryRoot, {
      repository: {
        branch: "main",
        head: baseHead,
        originMain: baseHead,
        workingTreeClean: true,
        headMatchesOriginMain: true,
      },
      state: {
        activePhase: {
          identifier: "16.9",
          title: "Reviewed closeout proposal",
          status: "incomplete",
        },
        currentObjective: "Ship the reviewed closeout proposal",
        completedWork: [],
        knownWarnings: [],
        nextSession: {
          objective: "Wire the dashboard summary UX",
          startingInspection: "Inspect ProgrammerDashboard.jsx",
        },
      },
    });

    commitFile(
      repositoryRoot,
      "one.txt",
      "1",
      "fix(developer): correct summary toggle",
    );
    commitFile(
      repositoryRoot,
      "two.txt",
      "2",
      "fix(developer): correct summary toggle",
    );
    commitFile(
      repositoryRoot,
      "three.txt",
      "3",
      "fix(developer): correct summary toggle",
    );
    commitFile(
      repositoryRoot,
      "four.txt",
      "4",
      "feat(developer): add fallback badges",
    );

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.generatedFrom.baselineTier).toBe("governanceState");
    expect(proposal.deliveredWork).toEqual([
      "fix(developer): correct summary toggle",
      "feat(developer): add fallback badges",
    ]);
    expect(proposal.deliveredWorkTotalInRange).toBe(4);
  });

  test("keeps recent feature-scope commits dominant over older unrelated-scope history once the current feature is committed", () => {
    const repositoryRoot = createFixtureRepository();

    commitFile(repositoryRoot, "base.txt", "a", "Initial commit");

    for (let index = 0; index < 3; index += 1) {
      commitFile(
        repositoryRoot,
        `legacy-${index}.txt`,
        String(index),
        `feat(legacy-widget): old unrelated work ${index}`,
      );
    }

    for (let index = 0; index < 8; index += 1) {
      commitFile(
        repositoryRoot,
        `feature-${index}.txt`,
        String(index),
        `feat(developer): dashboard work ${index}`,
      );
    }

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.generatedFrom.recoveryMode).toBe(true);
    expect(proposal.generatedFrom.dominantScope).toBe("developer");
    expect(proposal.deliveredWork.length).toBe(8);
    expect(
      proposal.deliveredWork.every((item) =>
        item.includes("dashboard work"),
      ),
    ).toBe(true);
    expect(
      proposal.deliveredWork.some((item) =>
        item.includes("old unrelated work"),
      ),
    ).toBe(false);
  });

  test("carries the synchronized roadmap's objective forward when the baseline checkpoint is trustworthy", () => {
    const repositoryRoot = createFixtureRepository();

    writeRoadmapStatusDocument(
      repositoryRoot,
      "Ship the bounded recovery proposal rewrite.",
    );

    const baseHead = commitFile(
      repositoryRoot,
      "base.txt",
      "a",
      "feat(developer): baseline",
    );

    writeGovernanceState(repositoryRoot, {
      repository: {
        branch: "main",
        head: baseHead,
        originMain: baseHead,
        workingTreeClean: true,
        headMatchesOriginMain: true,
      },
      state: {
        activePhase: {
          identifier: "16.9",
          title: "Reviewed closeout proposal",
          status: "incomplete",
        },
        currentObjective: "Ship the reviewed closeout proposal",
        completedWork: [],
        knownWarnings: [],
        nextSession: {
          objective: "Some prior, now-superseded next objective",
          startingInspection: "Inspect ProgrammerDashboard.jsx",
        },
      },
    });

    commitFile(
      repositoryRoot,
      "one.txt",
      "1",
      "feat(developer): apply bounded recovery policy",
    );

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.generatedFrom.roadmapObjectiveFound).toBe(true);
    expect(proposal.objective.endingObjective).toBe(
      "Ship the bounded recovery proposal rewrite.",
    );
    expect(proposal.nextSession.objective).toBe(
      "Ship the bounded recovery proposal rewrite.",
    );
    expect(proposal.fallbackApplied.objective).toBe(false);
  });

  test("falls back to a deterministic next-session objective when no reliable checkpoint or roadmap text exists", () => {
    const repositoryRoot = createFixtureRepository();

    commitFile(
      repositoryRoot,
      "a.txt",
      "a",
      "chore: repository work with no scope",
    );

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.generatedFrom.recoveryMode).toBe(true);
    expect(proposal.fallbackApplied.nextObjective).toBe(true);
    expect(proposal.nextSession.objective).toBe(
      "Inspect and prioritize the next FORGE roadmap objective.",
    );
  });

  test("produces a concise, policy-complete proposal even when governance state is stale and the intervening history is a large, unrelated commit dump", () => {
    const repositoryRoot = createFixtureRepository();

    const staleHead = commitFile(
      repositoryRoot,
      "base.txt",
      "a",
      "Initial base commit",
    );

    writeGovernanceState(repositoryRoot, {
      repository: {
        branch: "main",
        head: staleHead,
        originMain: staleHead,
        workingTreeClean: true,
        headMatchesOriginMain: true,
      },
      state: {
        activePhase: {
          identifier: "21D.15",
          title: "Decision intelligence validation",
          status: "complete",
        },
        currentObjective:
          "Phase 21D.15 validation completed and unrelated to current work",
        completedWork: [],
        knownWarnings: [],
        nextSession: {
          objective: "REVIEW_REQUIRED",
          startingInspection: "REVIEW_REQUIRED",
        },
      },
    });

    for (let index = 0; index < 55; index += 1) {
      commitFile(
        repositoryRoot,
        `history-${index}.txt`,
        String(index),
        `chore(decision-intelligence): historical work ${index}`,
      );
    }

    for (let index = 0; index < 6; index += 1) {
      commitFile(
        repositoryRoot,
        `feature-${index}.txt`,
        String(index),
        `feat(developer): fix visual verification defects ${index}`,
      );
    }

    setOriginMainToHead(repositoryRoot);

    const proposal = buildSessionCloseoutProposal({ repositoryRoot });

    expect(proposal.phase.identifier).not.toBe("REVIEW_REQUIRED");
    expect(proposal.phase.title).not.toBe("REVIEW_REQUIRED");
    expect(proposal.objective.endingObjective).not.toBe(
      "Phase 21D.15 validation completed and unrelated to current work",
    );
    expect(proposal.deliveredWork.length).toBeLessThanOrEqual(12);
    expect(proposal.generatedFrom.excludedCommitCount).toBeGreaterThan(0);
    expect(
      proposal.deliveredWork.every(
        (item) => !item.includes("historical work"),
      ),
    ).toBe(true);
    expect(proposal.nextSession.objective).not.toBe("REVIEW_REQUIRED");
    expect(proposal.nextSession.startingInspection).not.toBe(
      "REVIEW_REQUIRED",
    );
  });

  test("reports current validation evidence as eligible when it covers the current HEAD and every category passes", () => {
    const repositoryRoot = createFixtureRepository();

    copyValidatorScript(repositoryRoot);

    const head = commitFile(
      repositoryRoot,
      "a.txt",
      "a",
      "Initial commit",
    );

    setOriginMainToHead(repositoryRoot);

    writeValidationArtifact(repositoryRoot, {
      head,
      validationId: "forge-validation-20260811-000000",
    });

    const proposal = buildSessionCloseoutProposal({
      repositoryRoot,
    });

    expect(proposal.completion.eligible).toBe(true);
    expect(proposal.hasCurrentValidationArtifact).toBe(true);
    expect(proposal.validation.fullTests.status).toBe("passing");
  });

  test("reports no current validation artifact when evidence on disk is bound to a different commit", () => {
    const repositoryRoot = createFixtureRepository();

    copyValidatorScript(repositoryRoot);

    commitFile(repositoryRoot, "a.txt", "a", "Initial commit");
    setOriginMainToHead(repositoryRoot);

    writeValidationArtifact(repositoryRoot, {
      head: "1".repeat(40),
      validationId: "forge-validation-20260811-000000",
    });

    const proposal = buildSessionCloseoutProposal({
      repositoryRoot,
    });

    expect(proposal.completion.eligible).toBe(false);
    expect(proposal.hasCurrentValidationArtifact).toBe(false);
  });

  test("always requests completion by default, since this command runs validation live before the collector applies its own evidence gate", () => {
    const repositoryRoot = createFixtureRepository();

    copyValidatorScript(repositoryRoot);

    commitFile(repositoryRoot, "a.txt", "a", "Initial commit");
    setOriginMainToHead(repositoryRoot);

    writeValidationArtifact(repositoryRoot, {
      head: "1".repeat(40),
      validationId: "forge-validation-20260811-000000",
    });

    const proposal = buildSessionCloseoutProposal({
      repositoryRoot,
    });

    expect(proposal.completion.eligible).toBe(false);
    expect(proposal.completion.proposedMarkSessionComplete).toBe(true);
  });
});
