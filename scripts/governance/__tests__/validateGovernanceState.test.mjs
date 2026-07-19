import {
  describe,
  expect,
  it,
} from "vitest";

import {
  validateGovernanceState,
} from "../validateGovernanceState.mjs";

function clone(value) {
  return structuredClone(value);
}

function createDependencies() {
  return {
    promotionState: {
      version: "1.0",
      defaultAuthority: "human",
    },

    capabilitiesPolicy: {
      version: "1.0",
      defaultPolicy: "deny",

      capabilities: {
        updateShadowDocuments: true,
        updateAuthoritativeDocuments: false,
        changeGovernancePolicy: false,
        selectNextObjective: false,
      },
    },

    editableSectionsPolicy: {
      version: "1.0",
      defaultPolicy: "deny",
    },

    sessionSnapshot: {
      schemaVersion: "1.0",
      sessionId:
        "forge-session-20260718-150000",

      repository: {
        head:
          "24cd9ed24cd9ed24cd9ed24cd9ed24cd9ed24cd",
        branch: "main",
      },

      evidence: {
        capturedAt:
          "2026-07-18T20:00:00.000Z",
      },
    },
  };
}

function createGovernanceState() {
  return {
    schemaVersion: "1.0",

    repository: {
      branch: "main",
      head:
        "24cd9ed24cd9ed24cd9ed24cd9ed24cd9ed24cd",
      originMain:
        "24cd9ed24cd9ed24cd9ed24cd9ed24cd9ed24cd",
      workingTreeClean: false,
      headMatchesOriginMain: true,
    },

    session: {
      latestSnapshot:
        "governance/snapshots/forge-session-20260718-150000.json",
      lastUpdated:
        "2026-07-18T20:00:00.000Z",
    },

    state: {
      activePhase: {
        identifier: "15.11B",
        title:
          "Governance Relationship Validation",
        status: "active",
      },

      currentObjective:
        "Validate governance relationships.",

      completedWork: [
        "Governance architecture validator completed.",
      ],

      knownWarnings: [],

      nextSession: {
        objective:
          "Implement governance enforcement.",
        startingInspection:
          "Inspect reusable governance validators.",
      },
    },

    validation: {
      focusedTests: {
        status: "passing",
        command:
          "npx vitest run scripts/governance/__tests__",
        summary:
          "Focused governance validation passed.",
      },

      fullTests: {
        status: "not-run",
        command: null,
        summary: null,
      },

      productionBuild: {
        status: "not-run",
        command: null,
        summary: null,
      },
    },

    completion: {
      workComplete: false,
      supportedByEvidence: false,
      incompleteReason:
        "The active phase is still in progress.",
    },

    authority: {
      defaultAuthority: "human",
      promotionStateVersion: "1.0",
      capabilitiesVersion: "1.0",
      editableSectionsVersion: "1.0",
    },

    synchronization: {
      mode: "shadow",
      stateGeneratedAt: null,
      sourceSnapshot:
        "governance/snapshots/forge-session-20260718-150000.json",
      rendererVersion: null,
    },
  };
}

describe(
  "validateGovernanceState",
  () => {
    it(
      "accepts a valid governance state and returns an immutable summary",
      () => {
        const result =
          validateGovernanceState(
            createGovernanceState(),
            createDependencies(),
          );

        expect(result).toEqual({
          repositoryHead:
            "24cd9ed24cd9ed24cd9ed24cd9ed24cd9ed24cd",

          governanceMode: "shadow",
        });

        expect(
          Object.isFrozen(result),
        ).toBe(true);
      },
    );

    it(
      "rejects unsupported phase statuses",
      () => {
        const governanceState =
          createGovernanceState();

        governanceState.state
          .activePhase.status =
          "finished";

        expect(() =>
          validateGovernanceState(
            governanceState,
            createDependencies(),
          ),
        ).toThrow(
          "governanceState.state.activePhase.status is invalid",
        );
      },
    );

    it(
      "rejects unsupported governance modes",
      () => {
        const governanceState =
          createGovernanceState();

        governanceState.synchronization.mode =
          "automatic";

        expect(() =>
          validateGovernanceState(
            governanceState,
            createDependencies(),
          ),
        ).toThrow(
          "governanceState.synchronization.mode must be a supported governance mode",
        );
      },
    );

    it(
      "rejects mismatched promotion-state versions",
      () => {
        const dependencies =
          createDependencies();

        dependencies.promotionState.version =
          "2.0";

        expect(() =>
          validateGovernanceState(
            createGovernanceState(),
            dependencies,
          ),
        ).toThrow(
          "authority.promotionStateVersion disagrees with promotion-state.json",
        );
      },
    );

    it(
      "rejects capabilities policies that are not deny by default",
      () => {
        const dependencies =
          createDependencies();

        dependencies.capabilitiesPolicy
          .defaultPolicy =
          "allow";

        expect(() =>
          validateGovernanceState(
            createGovernanceState(),
            dependencies,
          ),
        ).toThrow(
          "Capabilities policy must remain deny by default",
        );
      },
    );

    it(
      "requires an incomplete reason when work is incomplete",
      () => {
        const governanceState =
          createGovernanceState();

        delete governanceState
          .completion
          .incompleteReason;

        expect(() =>
          validateGovernanceState(
            governanceState,
            createDependencies(),
          ),
        ).toThrow(
          "Incomplete work requires completion.incompleteReason",
        );
      },
    );

    it(
      "requires work completion and supporting evidence to agree",
      () => {
        const governanceState =
          createGovernanceState();

        governanceState.completion
          .workComplete =
          true;

        governanceState.completion
          .supportedByEvidence =
          false;

        expect(() =>
          validateGovernanceState(
            governanceState,
            createDependencies(),
          ),
        ).toThrow(
          "Completion requires both workComplete and supportedByEvidence",
        );
      },
    );

    it(
      "enforces REVIEW_REQUIRED state semantics",
      () => {
        const governanceState =
          createGovernanceState();

        governanceState.state
          .activePhase.identifier =
          "REVIEW_REQUIRED";

        governanceState.state
          .activePhase.status =
          "active";

        expect(() =>
          validateGovernanceState(
            governanceState,
            createDependencies(),
          ),
        ).toThrow(
          "REVIEW_REQUIRED state must use incomplete phase status",
        );
      },
    );

    it(
      "requires the referenced session snapshot dependency",
      () => {
        const dependencies =
          createDependencies();

        dependencies.sessionSnapshot =
          null;

        expect(() =>
          validateGovernanceState(
            createGovernanceState(),
            dependencies,
          ),
        ).toThrow(
          "sessionSnapshot is required when session.latestSnapshot is not null",
        );
      },
    );

    it(
      "accepts a null snapshot when no snapshot is referenced",
      () => {
        const governanceState =
          createGovernanceState();

        governanceState.session
          .latestSnapshot =
          null;

        governanceState.session
          .lastUpdated =
          null;

        governanceState.synchronization
          .sourceSnapshot =
          null;

        const dependencies =
          createDependencies();

        dependencies.sessionSnapshot =
          null;

        expect(() =>
          validateGovernanceState(
            governanceState,
            dependencies,
          ),
        ).not.toThrow();
      },
    );
  },
);
