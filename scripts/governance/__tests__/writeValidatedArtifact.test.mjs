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
  writeValidatedArtifact,
} from "../writeValidatedArtifact.mjs";

const temporaryDirectories =
  new Set();

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-validated-artifact-",
      ),
    );

  temporaryDirectories.add(
    repositoryRoot,
  );

  return repositoryRoot;
}

function readRelativeFile(
  repositoryRoot,
  relativePath,
) {
  return fs.readFileSync(
    path.join(
      repositoryRoot,
      relativePath,
    ),
    "utf8",
  );
}

function listTemporaryFiles(
  repositoryRoot,
) {
  const temporaryFiles = [];

  function inspectDirectory(
    directoryPath,
  ) {
    if (
      !fs.existsSync(
        directoryPath,
      )
    ) {
      return;
    }

    for (
      const entry
      of fs.readdirSync(
        directoryPath,
        {
          withFileTypes: true,
        },
      )
    ) {
      const entryPath =
        path.join(
          directoryPath,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        inspectDirectory(
          entryPath,
        );

        continue;
      }

      if (
        entry.name.endsWith(
          ".tmp",
        )
      ) {
        temporaryFiles.push(
          path.relative(
            repositoryRoot,
            entryPath,
          ),
        );
      }
    }
  }

  inspectDirectory(
    repositoryRoot,
  );

  return temporaryFiles.sort();
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

  vi.restoreAllMocks();
});

describe(
  "writeValidatedArtifact",
  () => {
    test(
      "validates a candidate before atomically promoting it",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const destinationPath =
          "governance/validation/example.json";

        const content =
          '{"status":"passing"}\n';

        const validateCandidate =
          vi.fn(
            (
              candidateRelativePath,
            ) => {
              expect(
                candidateRelativePath,
              ).toBe(
                `${destinationPath}.tmp`,
              );

              expect(
                readRelativeFile(
                  repositoryRoot,
                  candidateRelativePath,
                ),
              ).toBe(content);

              expect(
                fs.existsSync(
                  path.join(
                    repositoryRoot,
                    destinationPath,
                  ),
                ),
              ).toBe(false);
            },
          );

        const writtenPath =
          writeValidatedArtifact({
            repositoryRoot,
            destinationPath,
            content,
            validateCandidate,
          });

        expect(
          writtenPath,
        ).toBe(
          destinationPath,
        );

        expect(
          validateCandidate,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            destinationPath,
          ),
        ).toBe(content);

        expect(
          listTemporaryFiles(
            repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "removes the candidate when validation fails",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const destinationPath =
          "governance/validation/rejected.json";

        expect(() =>
          writeValidatedArtifact({
            repositoryRoot,
            destinationPath,
            content:
              '{"status":"invalid"}\n',
            validateCandidate() {
              throw new Error(
                "candidate validation failed",
              );
            },
          }),
        ).toThrow(
          "candidate validation failed",
        );

        expect(
          fs.existsSync(
            path.join(
              repositoryRoot,
              destinationPath,
            ),
          ),
        ).toBe(false);

        expect(
          listTemporaryFiles(
            repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "does not overwrite an existing artifact",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const destinationPath =
          "governance/validation/existing.json";

        const absoluteDestination =
          path.join(
            repositoryRoot,
            destinationPath,
          );

        fs.mkdirSync(
          path.dirname(
            absoluteDestination,
          ),
          {
            recursive: true,
          },
        );

        fs.writeFileSync(
          absoluteDestination,
          '{"original":true}\n',
          "utf8",
        );

        const validateCandidate =
          vi.fn();

        expect(() =>
          writeValidatedArtifact({
            repositoryRoot,
            destinationPath,
            content:
              '{"replacement":true}\n',
            validateCandidate,
          }),
        ).toThrow(
          `Artifact already exists: ${destinationPath}`,
        );

        expect(
          validateCandidate,
        ).not.toHaveBeenCalled();

        expect(
          readRelativeFile(
            repositoryRoot,
            destinationPath,
          ),
        ).toBe(
          '{"original":true}\n',
        );

        expect(
          listTemporaryFiles(
            repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "rejects a pre-existing candidate file",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const destinationPath =
          "governance/validation/example.json";

        const candidatePath =
          path.join(
            repositoryRoot,
            `${destinationPath}.tmp`,
          );

        fs.mkdirSync(
          path.dirname(
            candidatePath,
          ),
          {
            recursive: true,
          },
        );

        fs.writeFileSync(
          candidatePath,
          "existing candidate\n",
          "utf8",
        );

        expect(() =>
          writeValidatedArtifact({
            repositoryRoot,
            destinationPath,
            content:
              '{"status":"passing"}\n',
            validateCandidate() {},
          }),
        ).toThrow(
          `Artifact candidate already exists: ${destinationPath}.tmp`,
        );

        expect(
          fs.readFileSync(
            candidatePath,
            "utf8",
          ),
        ).toBe(
          "existing candidate\n",
        );
      },
    );

    test(
      "rejects destination paths outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          writeValidatedArtifact({
            repositoryRoot,
            destinationPath:
              "../outside.json",
            content:
              '{"status":"passing"}\n',
            validateCandidate() {},
          }),
        ).toThrow(
          "destinationPath must remain inside the repository",
        );
      },
    );

    test(
      "requires string content",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          writeValidatedArtifact({
            repositoryRoot,
            destinationPath:
              "governance/validation/example.json",
            content: {
              status: "passing",
            },
            validateCandidate() {},
          }),
        ).toThrow(
          "content must be a string",
        );
      },
    );

    test(
      "requires a candidate validator",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          writeValidatedArtifact({
            repositoryRoot,
            destinationPath:
              "governance/validation/example.json",
            content:
              '{"status":"passing"}\n',
          }),
        ).toThrow(
          "validateCandidate must be a function",
        );
      },
    );
  },
);
