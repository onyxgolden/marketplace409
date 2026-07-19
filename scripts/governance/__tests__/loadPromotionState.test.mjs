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
  loadPromotionState,
  PROMOTION_AUTHORITY_STATES,
  validatePromotionState,
} from "../loadPromotionState.mjs";

const temporaryDirectories =
  new Set();

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-promotion-state-",
      ),
    );

  temporaryDirectories.add(
    repositoryRoot,
  );

  fs.mkdirSync(
    path.join(
      repositoryRoot,
      "governance",
      "state",
    ),
    {
      recursive: true,
    },
  );

  return repositoryRoot;
}

function createValidState(
  overrides = {},
) {
  return {
    version: "1.0",
    lastUpdated: null,
    updatedBy: "owner",
    defaultAuthority:
      "human",
    trialCount: 0,
    documents: {
      "FORGE_SYNC_STATUS.md": {
        state:
          "shadow-only",
        successfulTrials:
          0,
        sections: {
          repository_state:
            "shadow-only",
          active_phase:
            "shadow-only",
          protected_rules:
            "human",
        },
      },
    },
    rules: [
      "Authority changes require explicit owner approval.",
    ],
    ...overrides,
  };
}

function writeState(
  repositoryRoot,
  state,
) {
  const statePath =
    path.join(
      repositoryRoot,
      "governance",
      "state",
      "promotion-state.json",
    );

  fs.writeFileSync(
    statePath,
    `${JSON.stringify(
      state,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return statePath;
}

afterEach(() => {
  for (
    const temporaryDirectory
    of temporaryDirectories
  ) {
    fs.rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryDirectories.clear();
});

describe(
  "validatePromotionState",
  () => {
    test(
      "accepts and deeply freezes a valid promotion state",
      () => {
        const state =
          validatePromotionState(
            createValidState(),
          );

        expect(
          state.version,
        ).toBe("1.0");

        expect(
          state.defaultAuthority,
        ).toBe("human");

        expect(
          state.trialCount,
        ).toBe(0);

        expect(
          Object.isFrozen(
            state,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            state.documents,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            state.documents[
              "FORGE_SYNC_STATUS.md"
            ],
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            state.documents[
              "FORGE_SYNC_STATUS.md"
            ].sections,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            state.rules,
          ),
        ).toBe(true);
      },
    );

    test(
      "supports every defined authority state",
      () => {
        const documents = {};

        for (
          const authorityState
          of PROMOTION_AUTHORITY_STATES
        ) {
          documents[
            `${authorityState}.md`
          ] = {
            state:
              authorityState,
            successfulTrials:
              0,
            sections: {
              test_section:
                authorityState,
            },
          };
        }

        const state =
          validatePromotionState(
            createValidState({
              documents,
            }),
          );

        expect(
          Object.keys(
            state.documents,
          ),
        ).toHaveLength(
          PROMOTION_AUTHORITY_STATES
            .length,
        );
      },
    );

    test(
      "rejects a non-human default authority",
      () => {
        expect(() =>
          validatePromotionState(
            createValidState({
              defaultAuthority:
                "agent-controlled",
            }),
          ),
        ).toThrow(
          "state.defaultAuthority must remain human",
        );
      },
    );

    test(
      "rejects a negative trial count",
      () => {
        expect(() =>
          validatePromotionState(
            createValidState({
              trialCount:
                -1,
            }),
          ),
        ).toThrow(
          "state.trialCount must be a non-negative integer",
        );
      },
    );

    test(
      "rejects an empty documents object",
      () => {
        expect(() =>
          validatePromotionState(
            createValidState({
              documents: {},
            }),
          ),
        ).toThrow(
          "state.documents must contain at least one promotion document",
        );
      },
    );

    test(
      "rejects an unsupported document authority state",
      () => {
        const state =
          createValidState();

        state.documents[
          "FORGE_SYNC_STATUS.md"
        ].state =
          "unsupported-state";

        expect(() =>
          validatePromotionState(
            state,
          ),
        ).toThrow(
          "state.documents.FORGE_SYNC_STATUS.md.state is unsupported: unsupported-state",
        );
      },
    );

    test(
      "rejects an unsupported section authority state",
      () => {
        const state =
          createValidState();

        state.documents[
          "FORGE_SYNC_STATUS.md"
        ].sections.repository_state =
          "unsupported-state";

        expect(() =>
          validatePromotionState(
            state,
          ),
        ).toThrow(
          "state.documents.FORGE_SYNC_STATUS.md.sections.repository_state is unsupported: unsupported-state",
        );
      },
    );

    test(
      "rejects negative successful trials",
      () => {
        const state =
          createValidState();

        state.documents[
          "FORGE_SYNC_STATUS.md"
        ].successfulTrials =
          -1;

        expect(() =>
          validatePromotionState(
            state,
          ),
        ).toThrow(
          "state.documents.FORGE_SYNC_STATUS.md.successfulTrials must be a non-negative integer",
        );
      },
    );

    test(
      "rejects a non-object sections value",
      () => {
        const state =
          createValidState();

        state.documents[
          "FORGE_SYNC_STATUS.md"
        ].sections =
          [];

        expect(() =>
          validatePromotionState(
            state,
          ),
        ).toThrow(
          "state.documents.FORGE_SYNC_STATUS.md.sections must be an object",
        );
      },
    );

    test(
      "rejects an invalid lastUpdated value",
      () => {
        expect(() =>
          validatePromotionState(
            createValidState({
              lastUpdated:
                "",
            }),
          ),
        ).toThrow(
          "state.lastUpdated must be null or a non-empty string",
        );
      },
    );

    test(
      "rejects invalid rules",
      () => {
        expect(() =>
          validatePromotionState(
            createValidState({
              rules: [
                "",
              ],
            }),
          ),
        ).toThrow(
          "state.rules must be an array of non-empty strings",
        );
      },
    );
  },
);

describe(
  "loadPromotionState",
  () => {
    test(
      "loads and validates the repository promotion state",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        writeState(
          repositoryRoot,
          createValidState(),
        );

        const state =
          loadPromotionState(
            undefined,
            {
              repositoryRoot,
            },
          );

        expect(
          state.version,
        ).toBe("1.0");

        expect(
          state.defaultAuthority,
        ).toBe("human");

        expect(
          Object.isFrozen(
            state,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            state.documents,
          ),
        ).toBe(true);
      },
    );

    test(
      "rejects a path outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          loadPromotionState(
            "../promotion-state.json",
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Promotion state must remain inside the repository",
        );
      },
    );

    test(
      "reports a missing promotion state",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          loadPromotionState(
            undefined,
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Promotion state does not exist: governance/state/promotion-state.json",
        );
      },
    );

    test(
      "reports invalid JSON",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const statePath =
          path.join(
            repositoryRoot,
            "governance",
            "state",
            "promotion-state.json",
          );

        fs.writeFileSync(
          statePath,
          "{ invalid json",
          "utf8",
        );

        expect(() =>
          loadPromotionState(
            undefined,
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Promotion state is not valid JSON",
        );
      },
    );

    test(
      "rejects invalid supplied paths and repository roots",
      () => {
        expect(() =>
          loadPromotionState(
            "",
          ),
        ).toThrow(
          "suppliedPath must be a non-empty string",
        );

        expect(() =>
          loadPromotionState(
            undefined,
            {
              repositoryRoot:
                "",
            },
          ),
        ).toThrow(
          "repositoryRoot must be a non-empty string",
        );
      },
    );
  },
);
