import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  renderAllShadowDocuments,
} from "../renderShadowDocuments.mjs";

const temporaryDirectories = [];

function writeJson(
  repositoryRoot,
  relativePath,
  value,
) {
  const absolutePath =
    path.join(
      repositoryRoot,
      relativePath,
    );

  fs.mkdirSync(
    path.dirname(absolutePath),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    absolutePath,
    `${JSON.stringify(
      value,
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function writeDocument(
  repositoryRoot,
  documentName,
  content,
) {
  const directory =
    path.join(
      repositoryRoot,
      "docs/architecture/synchronized",
    );

  fs.mkdirSync(
    directory,
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.join(
      directory,
      documentName,
    ),
    content,
    "utf8",
  );
}

function createRepositoryFixture({
  validationStatus = "passing",
} = {}) {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-objective-render-",
      ),
    );

  temporaryDirectories.push(
    repositoryRoot,
  );

  const governanceState = {
    schemaVersion: "1.0",
    repository: {
      branch: "main",
      head: "abcdef1",
      originMain: "abcdef1",
      workingTreeClean: true,
      headMatchesOriginMain: true,
    },
    session: {
      latestSnapshot: null,
      lastUpdated: null,
    },
    state: {
      activePhase: {
        identifier:
          "REVIEW_REQUIRED",
        title:
          "REVIEW_REQUIRED",
        status:
          "incomplete",
      },
      currentObjective:
        "REVIEW_REQUIRED",
      completedWork: [],
      knownWarnings: [],
      nextSession: {
        objective:
          "REVIEW_REQUIRED",
        startingInspection:
          "REVIEW_REQUIRED",
      },
    },
    validation: {
      focusedTests: {
        status:
          validationStatus,
      },
      fullTests: {
        status:
          validationStatus,
      },
      productionBuild: {
        status:
          validationStatus,
      },
    },
    completion: {
      workComplete: false,
      supportedByEvidence:
        false,
      incompleteReason:
        "Human review required.",
    },
    authority: {
      defaultAuthority:
        "human",
      promotionStateVersion:
        "1.0",
      capabilitiesVersion:
        "1.0",
      editableSectionsVersion:
        "1.0",
    },
    synchronization: {
      mode:
        "shadow-only",
      stateGeneratedAt:
        null,
      sourceSnapshot:
        null,
      rendererVersion:
        null,
    },
  };

  writeJson(
    repositoryRoot,
    "governance/state/current-governance-state.json",
    governanceState,
  );

  writeJson(
    repositoryRoot,
    "governance/state/promotion-state.json",
    {
      version: "1.0",
      defaultAuthority:
        "human",
      trialCount: 0,
      documents: {},
    },
  );

  writeJson(
    repositoryRoot,
    "governance/policies/promotion-policy.json",
    {
      version: "1.0",
      minimumSuccessfulTrials: 3,
      promotionScope:
        "section",
      requirements: {
        protectedContentMutations:
          0,
        inventedCompletionClaims:
          0,
        unsupportedArchitecturalClaims:
          0,
        authoritativeDocumentMutations:
          0,
        criticalFactualErrors:
          0,
        incompleteWorkMarkedComplete:
          0,
        explicitOwnerApproval:
          true,
      },
      requiredTrialTypes: [],
    },
  );

  writeJson(
    repositoryRoot,
    "governance/policies/capabilities.json",
    {
      version: "1.0",
      capabilities: {
        selectNextObjective:
          false,
      },
    },
  );

  writeJson(
    repositoryRoot,
    "governance/policies/objective-policy.json",
    {
      version: "1.0",
      roadmapPosition: {
        nextPhaseIdentifier:
          "15.2",
      },
      phases: [
        {
          identifier:
            "15.1",
          title:
            "Promotion Evaluation",
          status:
            "complete",
          objective:
            "Evaluate promotion.",
          prerequisites: [],
        },
        {
          identifier:
            "15.2",
          title:
            "Objective Recommendation Engine",
          status:
            "planned",
          objective:
            "Generate advisory objective recommendations.",
          prerequisites: [
            "15.1",
          ],
        },
      ],
    },
  );

  const ordinaryDocument =
    "<!-- FORGE:SYNC:synchronization_metadata:START -->\nold\n<!-- FORGE:SYNC:synchronization_metadata:END -->";

  writeDocument(
    repositoryRoot,
    "FORGE_SYNC_CONTROL_CENTER.md",
    [
      "<!-- FORGE:SYNC:repository_state:START -->",
      "old",
      "<!-- FORGE:SYNC:repository_state:END -->",
      "<!-- FORGE:SYNC:active_phase:START -->",
      "old",
      "<!-- FORGE:SYNC:active_phase:END -->",
      "<!-- FORGE:SYNC:current_objective:START -->",
      "old",
      "<!-- FORGE:SYNC:current_objective:END -->",
      "<!-- FORGE:SYNC:completed_work:START -->",
      "old",
      "<!-- FORGE:SYNC:completed_work:END -->",
      "<!-- FORGE:SYNC:validation_evidence:START -->",
      "old",
      "<!-- FORGE:SYNC:validation_evidence:END -->",
      ordinaryDocument,
    ].join("\n"),
  );

  writeDocument(
    repositoryRoot,
    "FORGE_SYNC_STATUS.md",
    [
      "<!-- FORGE:SYNC:repository_state:START -->",
      "old",
      "<!-- FORGE:SYNC:repository_state:END -->",
      "<!-- FORGE:SYNC:active_phase:START -->",
      "old",
      "<!-- FORGE:SYNC:active_phase:END -->",
      "<!-- FORGE:SYNC:current_objective:START -->",
      "old",
      "<!-- FORGE:SYNC:current_objective:END -->",
      "<!-- FORGE:SYNC:capability_status:START -->",
      "old",
      "<!-- FORGE:SYNC:capability_status:END -->",
      "<!-- FORGE:SYNC:validation_evidence:START -->",
      "old",
      "<!-- FORGE:SYNC:validation_evidence:END -->",
      ordinaryDocument,
    ].join("\n"),
  );

  writeDocument(
    repositoryRoot,
    "FORGE_SYNC_SESSION.md",
    [
      "<!-- FORGE:SYNC:active_phase:START -->",
      "old",
      "<!-- FORGE:SYNC:active_phase:END -->",
      "<!-- FORGE:SYNC:current_objective:START -->",
      "old",
      "<!-- FORGE:SYNC:current_objective:END -->",
      "<!-- FORGE:SYNC:last_completed_work:START -->",
      "old",
      "<!-- FORGE:SYNC:last_completed_work:END -->",
      "<!-- FORGE:SYNC:repository_health:START -->",
      "old",
      "<!-- FORGE:SYNC:repository_health:END -->",
      "<!-- FORGE:SYNC:known_warnings:START -->",
      "old",
      "<!-- FORGE:SYNC:known_warnings:END -->",
      "<!-- FORGE:SYNC:starting_inspection:START -->",
      "old",
      "<!-- FORGE:SYNC:starting_inspection:END -->",
      ordinaryDocument,
    ].join("\n"),
  );

  writeDocument(
    repositoryRoot,
    "FORGE_SYNC_ROADMAP.md",
    [
      "<!-- FORGE:SYNC:verified_validation_evidence:START -->",
      "old",
      "<!-- FORGE:SYNC:verified_validation_evidence:END -->",
      ordinaryDocument,
    ].join("\n"),
  );

  writeDocument(
    repositoryRoot,
    "FORGE_SYNC_EVALUATION.md",
    [
      "<!-- FORGE:SYNC:trial_history:START -->",
      "old",
      "<!-- FORGE:SYNC:trial_history:END -->",
      "<!-- FORGE:SYNC:comparison_results:START -->",
      "old",
      "<!-- FORGE:SYNC:comparison_results:END -->",
      "<!-- FORGE:SYNC:observed_strengths:START -->",
      "old",
      "<!-- FORGE:SYNC:observed_strengths:END -->",
      "<!-- FORGE:SYNC:observed_failures:START -->",
      "old",
      "<!-- FORGE:SYNC:observed_failures:END -->",
      "<!-- FORGE:SYNC:corrections_required:START -->",
      "old",
      "<!-- FORGE:SYNC:corrections_required:END -->",
      "<!-- FORGE:SYNC:promotion_recommendations:START -->",
      "old",
      "<!-- FORGE:SYNC:promotion_recommendations:END -->",
      ordinaryDocument,
    ].join("\n"),
  );

  return repositoryRoot;
}

afterEach(() => {
  while (
    temporaryDirectories.length > 0
  ) {
    fs.rmSync(
      temporaryDirectories.pop(),
      {
        recursive: true,
        force: true,
      },
    );
  }
});

describe(
  "production objective recommendation rendering",
  () => {
    test(
      "renders the policy-backed advisory objective when evidence passes",
      () => {
        const repositoryRoot =
          createRepositoryFixture();

        const rendered =
          renderAllShadowDocuments({
            repositoryRoot,
          });

        const evaluation =
          rendered[
            "FORGE_SYNC_EVALUATION.md"
          ];

        expect(evaluation).toContain(
          "Phase 15.2 — Objective Recommendation Engine",
        );

        expect(evaluation).toContain(
          "Generate advisory objective recommendations.",
        );

        expect(evaluation).toContain(
          "Human approval remains required.",
        );

        expect(evaluation).not.toContain(
          "selectedObjective",
        );
      },
    );

    test(
      "does not recommend an objective when validation evidence has not passed",
      () => {
        const repositoryRoot =
          createRepositoryFixture({
            validationStatus:
              "not-run",
          });

        const rendered =
          renderAllShadowDocuments({
            repositoryRoot,
          });

        const evaluation =
          rendered[
            "FORGE_SYNC_EVALUATION.md"
          ];

        expect(evaluation).toContain(
          "No objective recommendations have been made.",
        );

        expect(evaluation).not.toContain(
          "Phase 15.2 — Objective Recommendation Engine",
        );
      },
    );
  },
);
