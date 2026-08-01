import {
  execFile,
} from "node:child_process";

import {
  promisify,
} from "node:util";

const execFileAsync =
  promisify(execFile);

function freezeFacts({
  branch,
  head,
  originMain,
  workingTreeClean,
  changedFiles,
}) {
  return Object.freeze({
    branch,
    head,
    originMain,
    headMatchesOriginMain:
      head === originMain,
    workingTreeClean,
    changedFiles:
      Object.freeze([...changedFiles]),
  });
}

async function runGit(
  repositoryPath,
  args,
) {
  const result =
    await execFileAsync(
      "git",
      args,
      {
        cwd: repositoryPath,
      },
    );

  return result.stdout.trim();
}

export class RepositoryInspectionProvider {
  async inspect(repositoryPath) {
    const branch =
      await runGit(
        repositoryPath,
        [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ],
      );

    const head =
      await runGit(
        repositoryPath,
        [
          "rev-parse",
          "HEAD",
        ],
      );

    const originMain =
      await runGit(
        repositoryPath,
        [
          "rev-parse",
          "origin/main",
        ],
      );

    const status =
      await runGit(
        repositoryPath,
        [
          "status",
          "--short",
        ],
      );

    const changedFiles =
      status.length === 0
        ? []
        : status
            .split("\n")
            .map(
              (line) =>
                line.slice(3),
            );

    return freezeFacts({
      branch,
      head,
      originMain,
      workingTreeClean:
        changedFiles.length === 0,
      changedFiles,
    });
  }
}
