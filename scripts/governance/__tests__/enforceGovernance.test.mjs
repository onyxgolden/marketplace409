import {
  spawnSync,
} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  enforceGovernance,
  GOVERNANCE_ENFORCEMENT_VERSION,
  GOVERNANCE_VALIDATION_ORDER,
} from "../enforceGovernance.mjs";

const temporaryDirectories = [];

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-governance-enforcement-",
      ),
    );

  temporaryDirectories.push(
    repositoryRoot,
  );

  return repositoryRoot;
}

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
    path.dirname(
      absolutePath,
    ),
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

function createRepositoryArtifacts(
  repositoryRoot,
) {
  const paths = {
    validationEvidence:
      "governance/validation/forge-validation-20260718-150000.json",

    governanceState:
      "governance/state/current-governance-state.json",

    objectivePolicy:
      "governance/policies/objective-policy.json",

    capabilitiesPolicy:
      "governance/policies/capabilities.json",

    promotionState:
      "governance/state/promotion-state.json",

    editableSectionsPolicy:
      "governance/policies/editable-sections.json",

    sessionSnapshot:
      "governance/snapshots/forge-session-20260718-150000.json",
  };

  writeJson(
    repositoryRoot,
    paths.objectivePolicy,
    {
      version: "1.0",
      phases: [],
    },
  );

  writeJson(
    repositoryRoot,
    paths.capabilitiesPolicy,
    {
      version: "1.0",
      capabilities: {},
    },
  );

  writeJson(
    repositoryRoot,
    paths.validationEvidence,
    {
      validationId:
        "forge-validation-20260718-150000",
    },
  );

  writeJson(
    repositoryRoot,
    paths.promotionState,
    {
      version: "1.0",
    },
  );

  writeJson(
    repositoryRoot,
    paths.editableSectionsPolicy,
    {
      version: "1.0",
    },
  );

  writeJson(
    repositoryRoot,
    paths.sessionSnapshot,
    {
      schemaVersion: "1.0",
    },
  );

  writeJson(
    repositoryRoot,
    paths.governanceState,
    {
      schemaVersion: "1.0",

      session: {
        latestSnapshot:
          paths.sessionSnapshot,
      },
    },
  );

  return paths;
}

function createValidators(
  calls,
) {
  return {
    governanceArchitecture:
      vi.fn(
        ({ repositoryRoot }) => {
          calls.push(
            "governanceArchitecture",
          );

          return {
            repositoryRoot,
            valid: true,
          };
        },
      ),

    objectivePolicy:
      vi.fn(
        (
          objectivePolicy,
          capabilitiesPolicy,
        ) => {
          calls.push(
            "objectivePolicy",
          );

          return {
            objectiveVersion:
              objectivePolicy.version,

            capabilitiesVersion:
              capabilitiesPolicy.version,
          };
        },
      ),

    validationEvidence:
      vi.fn(
        (validationEvidence) => {
          calls.push(
            "validationEvidence",
          );

          return {
            validationId:
              validationEvidence
                .validationId,
          };
        },
      ),

    governanceState:
      vi.fn(
        (
          governanceState,
          dependencies,
        ) => {
          calls.push(
            "governanceState",
          );

          return {
            schemaVersion:
              governanceState
                .schemaVersion,

            promotionVersion:
              dependencies
                .promotionState
                .version,

            capabilitiesVersion:
              dependencies
                .capabilitiesPolicy
                .version,

            editableSectionsVersion:
              dependencies
                .editableSectionsPolicy
                .version,

            snapshotVersion:
              dependencies
                .sessionSnapshot
                ?.schemaVersion ??
              null,
          };
        },
      ),
  };
}

afterEach(() => {
  vi.restoreAllMocks();

  for (
    const temporaryDirectory
    of temporaryDirectories.splice(0)
  ) {
    fs.rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

describe(
  "enforceGovernance",
  () => {
    test(
      "runs governance validators in deterministic order",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const paths =
          createRepositoryArtifacts(
            repositoryRoot,
          );

        const calls = [];

        const result =
          enforceGovernance({
            repositoryRoot,

            validationEvidencePath:
              paths.validationEvidence,

            paths: {
              governanceState:
                paths.governanceState,

              objectivePolicy:
                paths.objectivePolicy,

              capabilitiesPolicy:
                paths.capabilitiesPolicy,

              promotionState:
                paths.promotionState,

              editableSectionsPolicy:
                paths.editableSectionsPolicy,
            },

            validators:
              createValidators(
                calls,
              ),
          });

        expect(calls).toEqual([
          "governanceArchitecture",
          "objectivePolicy",
          "validationEvidence",
          "governanceState",
        ]);

        expect(
          result.validationOrder,
        ).toEqual(
          GOVERNANCE_VALIDATION_ORDER,
        );

        expect(result).toMatchObject({
          version:
            GOVERNANCE_ENFORCEMENT_VERSION,

          valid: true,

          validationEvidencePath:
            paths.validationEvidence,

          governanceStatePath:
            paths.governanceState,
        });
      },
    );

    test(
      "composes governance-state dependencies from repository artifacts",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const paths =
          createRepositoryArtifacts(
            repositoryRoot,
          );

        const calls = [];

        const validators =
          createValidators(
            calls,
          );

        enforceGovernance({
          repositoryRoot,

          validationEvidencePath:
            paths.validationEvidence,

          paths: {
            governanceState:
              paths.governanceState,

            objectivePolicy:
              paths.objectivePolicy,

            capabilitiesPolicy:
              paths.capabilitiesPolicy,

            promotionState:
              paths.promotionState,

            editableSectionsPolicy:
              paths.editableSectionsPolicy,
          },

          validators,
        });

        expect(
          validators.governanceState,
        ).toHaveBeenCalledTimes(1);

        const [
          governanceState,
          dependencies,
        ] =
          validators
            .governanceState
            .mock.calls[0];

        expect(
          governanceState
            .schemaVersion,
        ).toBe("1.0");

        expect(
          dependencies,
        ).toEqual({
          promotionState: {
            version: "1.0",
          },

          capabilitiesPolicy: {
            version: "1.0",
            capabilities: {},
          },

          editableSectionsPolicy: {
            version: "1.0",
          },

          sessionSnapshot: {
            schemaVersion: "1.0",
          },
        });
      },
    );

    test(
      "stops immediately when a validator fails",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const paths =
          createRepositoryArtifacts(
            repositoryRoot,
          );

        const calls = [];

        const validators =
          createValidators(
            calls,
          );

        validators.objectivePolicy =
          vi.fn(() => {
            calls.push(
              "objectivePolicy",
            );

            throw new Error(
              "Objective policy rejected",
            );
          });

        expect(() =>
          enforceGovernance({
            repositoryRoot,

            validationEvidencePath:
              paths.validationEvidence,

            paths: {
              governanceState:
                paths.governanceState,

              objectivePolicy:
                paths.objectivePolicy,

              capabilitiesPolicy:
                paths.capabilitiesPolicy,

              promotionState:
                paths.promotionState,

              editableSectionsPolicy:
                paths.editableSectionsPolicy,
            },

            validators,
          }),
        ).toThrow(
          "Objective policy rejected",
        );

        expect(calls).toEqual([
          "governanceArchitecture",
          "objectivePolicy",
        ]);

        expect(
          validators.validationEvidence,
        ).not.toHaveBeenCalled();

        expect(
          validators.governanceState,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "returns a deeply immutable enforcement summary",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const paths =
          createRepositoryArtifacts(
            repositoryRoot,
          );

        const result =
          enforceGovernance({
            repositoryRoot,

            validationEvidencePath:
              paths.validationEvidence,

            paths: {
              governanceState:
                paths.governanceState,

              objectivePolicy:
                paths.objectivePolicy,

              capabilitiesPolicy:
                paths.capabilitiesPolicy,

              promotionState:
                paths.promotionState,

              editableSectionsPolicy:
                paths.editableSectionsPolicy,
            },

            validators:
              createValidators([]),
          });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.validationOrder,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.results,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.results
              .governanceState,
          ),
        ).toBe(true);
      },
    );

    test(
      "requires an explicit validation-evidence path",
      () => {
        expect(() =>
          enforceGovernance(),
        ).toThrow(
          "validationEvidencePath must be a non-empty string",
        );
      },
    );

    test(
      "rejects validation evidence outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const paths =
          createRepositoryArtifacts(
            repositoryRoot,
          );

        expect(() =>
          enforceGovernance({
            repositoryRoot,

            validationEvidencePath:
              "../outside.json",

            paths: {
              governanceState:
                paths.governanceState,

              objectivePolicy:
                paths.objectivePolicy,

              capabilitiesPolicy:
                paths.capabilitiesPolicy,

              promotionState:
                paths.promotionState,

              editableSectionsPolicy:
                paths.editableSectionsPolicy,
            },

            validators:
              createValidators([]),
          }),
        ).toThrow(
          "Validation evidence path must remain inside the repository",
        );
      },
    );

    test(
      "accepts a null referenced session snapshot",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const paths =
          createRepositoryArtifacts(
            repositoryRoot,
          );

        writeJson(
          repositoryRoot,
          paths.governanceState,
          {
            schemaVersion: "1.0",

            session: {
              latestSnapshot: null,
            },
          },
        );

        const validators =
          createValidators([]);

        enforceGovernance({
          repositoryRoot,

          validationEvidencePath:
            paths.validationEvidence,

          paths: {
            governanceState:
              paths.governanceState,

            objectivePolicy:
              paths.objectivePolicy,

            capabilitiesPolicy:
              paths.capabilitiesPolicy,

            promotionState:
              paths.promotionState,

            editableSectionsPolicy:
              paths.editableSectionsPolicy,
          },

          validators,
        });

        const dependencies =
          validators
            .governanceState
            .mock.calls[0][1];

        expect(
          dependencies.sessionSnapshot,
        ).toBeNull();
      },
    );

    test(
      "CLI fails when validation-evidence path is omitted",
      () => {
        const result =
          spawnSync(
            process.execPath,
            [
              "scripts/governance/enforceGovernance.mjs",
            ],
            {
              cwd:
                path.resolve(
                  process.cwd(),
                ),

              encoding:
                "utf8",
            },
          );

        expect(
          result.status,
        ).toBe(1);

        expect(
          result.stderr,
        ).toContain(
          "Usage: node scripts/governance/enforceGovernance.mjs <validation-evidence-path> [governance-state-path]",
        );
      },
    );
  },
);
