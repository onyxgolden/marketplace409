import {
  execFileSync,
  spawnSync,
} from "node:child_process";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  describe,
  expect,
  test,
} from "vitest";

const repositoryRoot =
  process.cwd();

const validatorPath =
  path.join(
    repositoryRoot,
    "scripts/governance/validateObjectivePolicy.mjs",
  );

const policyPath =
  path.join(
    repositoryRoot,
    "governance/policies/objective-policy.json",
  );

function readPolicy() {
  return JSON.parse(
    fs.readFileSync(
      policyPath,
      "utf8",
    ),
  );
}

function writeTemporaryPolicy(
  policy,
) {
  const directory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-objective-policy-",
      ),
    );

  const temporaryPath =
    path.join(
      directory,
      "objective-policy.json",
    );

  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      policy,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    directory,
    temporaryPath,
  };
}

describe(
  "validateObjectivePolicy",
  () => {
    test(
      "accepts the repository objective policy",
      () => {
        const output =
          execFileSync(
            process.execPath,
            [
              validatorPath,
              policyPath,
            ],
            {
              cwd:
                repositoryRoot,
              encoding:
                "utf8",
            },
          );

        expect(output).toContain(
          "VALID OBJECTIVE POLICY",
        );

        expect(output).toContain(
          "Next phase: 15.2",
        );
      },
    );

    test(
      "rejects objective-selection authority",
      () => {
        const policy =
          readPolicy();

        policy.selectionAllowed =
          true;

        const {
          directory,
          temporaryPath,
        } =
          writeTemporaryPolicy(
            policy,
          );

        try {
          const result =
            spawnSync(
              process.execPath,
              [
                validatorPath,
                temporaryPath,
              ],
              {
                cwd:
                  repositoryRoot,
                encoding:
                  "utf8",
              },
            );

          expect(
            result.status,
          ).not.toBe(0);

          expect(
            result.stderr,
          ).toContain(
            "selectionAllowed must remain false",
          );
        } finally {
          fs.rmSync(
            directory,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );

    test(
      "rejects an undefined architectural prerequisite",
      () => {
        const policy =
          readPolicy();

        policy.phases[1]
          .prerequisites = [
            "14.9",
          ];

        const {
          directory,
          temporaryPath,
        } =
          writeTemporaryPolicy(
            policy,
          );

        try {
          const result =
            spawnSync(
              process.execPath,
              [
                validatorPath,
                temporaryPath,
              ],
              {
                cwd:
                  repositoryRoot,
                encoding:
                  "utf8",
              },
            );

          expect(
            result.status,
          ).not.toBe(0);

          expect(
            result.stderr,
          ).toContain(
            "undefined prerequisite 14.9",
          );
        } finally {
          fs.rmSync(
            directory,
            {
              recursive: true,
              force: true,
            },
          );
        }
      },
    );
  },
);
