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
  GOVERNANCE_MODES,
  loadGovernanceMode,
  validateGovernanceModeConfiguration,
} from "../loadGovernanceMode.mjs";

const temporaryDirectories = new Set();

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-governance-mode-",
      ),
    );

  temporaryDirectories.add(
    repositoryRoot,
  );

  fs.mkdirSync(
    path.join(
      repositoryRoot,
      "governance",
      "config",
    ),
    {
      recursive: true,
    },
  );

  return repositoryRoot;
}

function writeConfiguration(
  repositoryRoot,
  configuration,
) {
  const configurationPath = path.join(
    repositoryRoot,
    "governance",
    "config",
    "governance-mode.json",
  );

  fs.writeFileSync(
    configurationPath,
    `${JSON.stringify(configuration, null, 2)}\n`,
    "utf8",
  );

  return configurationPath;
}

function createValidConfiguration(
  overrides = {},
) {
  return {
    version: "1.0",
    mode: "shadow",
    allowedModes: [
      ...GOVERNANCE_MODES,
    ],
    description:
      "Test governance mode configuration.",
    rules: [],
    ...overrides,
  };
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
  "validateGovernanceModeConfiguration",
  () => {
    test(
      "accepts every supported active mode",
      () => {
        for (
          const mode
          of GOVERNANCE_MODES
        ) {
          const configuration =
            validateGovernanceModeConfiguration(
              createValidConfiguration({
                mode,
              }),
            );

          expect(
            configuration.mode,
          ).toBe(mode);

          expect(
            Object.isFrozen(
              configuration,
            ),
          ).toBe(true);

          expect(
            Object.isFrozen(
              configuration.allowedModes,
            ),
          ).toBe(true);
        }
      },
    );

    test(
      "rejects an unsupported active mode",
      () => {
        expect(() =>
          validateGovernanceModeConfiguration(
            createValidConfiguration({
              mode: "unsafe",
            }),
          ),
        ).toThrow(
          "Unsupported governance mode: unsafe",
        );
      },
    );

    test(
      "rejects missing supported modes",
      () => {
        expect(() =>
          validateGovernanceModeConfiguration(
            createValidConfiguration({
              allowedModes: [
                "locked",
                "shadow",
                "hybrid",
              ],
            }),
          ),
        ).toThrow(
          "Governance mode allowedModes must contain every supported mode exactly once",
        );
      },
    );

    test(
      "rejects duplicate modes",
      () => {
        expect(() =>
          validateGovernanceModeConfiguration(
            createValidConfiguration({
              allowedModes: [
                "locked",
                "shadow",
                "hybrid",
                "hybrid",
              ],
            }),
          ),
        ).toThrow(
          "Governance mode allowedModes may not contain duplicates",
        );
      },
    );

    test(
      "rejects unsupported entries",
      () => {
        expect(() =>
          validateGovernanceModeConfiguration(
            createValidConfiguration({
              allowedModes: [
                "locked",
                "shadow",
                "hybrid",
                "unsafe",
              ],
            }),
          ),
        ).toThrow(
          "Governance mode allowedModes is missing supported mode: authoritative",
        );
      },
    );
  },
);

describe(
  "loadGovernanceMode",
  () => {
    test(
      "loads and validates repository configuration",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        writeConfiguration(
          repositoryRoot,
          createValidConfiguration({
            mode: "hybrid",
          }),
        );

        const configuration =
          loadGovernanceMode(
            undefined,
            {
              repositoryRoot,
            },
          );

        expect(
          configuration.mode,
        ).toBe("hybrid");
      },
    );

    test(
      "rejects missing configuration",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          loadGovernanceMode(
            undefined,
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Governance mode configuration does not exist",
        );
      },
    );

    test(
      "rejects invalid JSON",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const configurationPath =
          path.join(
            repositoryRoot,
            "governance",
            "config",
            "governance-mode.json",
          );

        fs.writeFileSync(
          configurationPath,
          "{ invalid json",
          "utf8",
        );

        expect(() =>
          loadGovernanceMode(
            undefined,
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Governance mode configuration is not valid JSON",
        );
      },
    );

    test(
      "rejects paths outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          loadGovernanceMode(
            "../governance-mode.json",
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Governance mode configuration must remain inside the repository",
        );
      },
    );
  },
);
