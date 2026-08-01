import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import {
  dirname,
  join,
} from "path";
import {
  fileURLToPath,
} from "url";
import {
  spawnSync,
} from "child_process";

const currentDirectory = dirname(
  fileURLToPath(import.meta.url),
);

const forgeCli = join(
  currentDirectory,
  "../forge.js",
);

describe("FORGE OS execution CLI", () => {
  const temporaryRepositories = [];

  function createRepository() {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "forge-execution-cli-"),
    );

    temporaryRepositories.push(repositoryRoot);

    mkdirSync(
      join(repositoryRoot, "tools/forge-os"),
      {
        recursive: true,
      },
    );

    writeFileSync(
      join(
        repositoryRoot,
        "FORGE_CONSTITUTION.json",
      ),
      JSON.stringify({
        version: 1,
        rules: [
          {
            type: "require_inspect_before_edit",
          },
          {
            type: "require_test_after_edit",
          },
          {
            type: "no_unverified_patches",
          },
        ],
      }),
      "utf8",
    );

    return repositoryRoot;
  }

  afterEach(() => {
    while (temporaryRepositories.length > 0) {
      rmSync(
        temporaryRepositories.pop(),
        {
          recursive: true,
          force: true,
        },
      );
    }
  });

  it("rejects mutations hidden inside a shell wrapper", () => {
    const repositoryRoot = createRepository();

    const protectedFile = join(
      repositoryRoot,
      "protected.txt",
    );

    writeFileSync(
      protectedFile,
      "must remain",
      "utf8",
    );

    writeFileSync(
      join(
        repositoryRoot,
        "tools/forge-os/.forge-plan.json",
      ),
      JSON.stringify({
        version: 2,
        phase: "Shell wrapper authorization test",
        objective:
          "Inspection commands must remain read-only",
        steps: [
          {
            action: "inspect",
            description:
              "Hides a mutation inside a shell wrapper",
            command:
              "sh -c 'rm -f protected.txt'",
          },
        ],
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [forgeCli, "run"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).not.toBe(0);

    expect(
      result.stdout + result.stderr,
    ).toContain(
      "Command rejected by FORGE execution policy",
    );

    expect(existsSync(protectedFile)).toBe(true);
  });

  it("rejects mutating commands disguised as inspection", () => {
    const repositoryRoot = createRepository();

    const protectedFile = join(
      repositoryRoot,
      "protected.txt",
    );

    writeFileSync(
      protectedFile,
      "must remain",
      "utf8",
    );

    writeFileSync(
      join(
        repositoryRoot,
        "tools/forge-os/.forge-plan.json",
      ),
      JSON.stringify({
        version: 2,
        phase: "Command authorization test",
        objective:
          "A mislabeled command must not mutate files",
        steps: [
          {
            action: "inspect",
            description:
              "Pretends to inspect repository state",
            command: "rm -f protected.txt",
          },
        ],
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [forgeCli, "run"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).not.toBe(0);

    expect(
      result.stdout + result.stderr,
    ).toContain(
      "Command rejected by FORGE execution policy",
    );

    expect(existsSync(protectedFile)).toBe(true);
  });

  it("rejects a plan that violates the constitution before execution", () => {
    const repositoryRoot = createRepository();

    const markerFile = join(
      repositoryRoot,
      "unsafe-command-executed.txt",
    );

    writeFileSync(
      join(
        repositoryRoot,
        "tools/forge-os/.forge-plan.json",
      ),
      JSON.stringify({
        version: 2,
        phase: "Unsafe execution test",
        objective: "Must not execute",
        steps: [
          {
            action: "edit",
            description:
              "Edit without inspection or tests",
            command:
              "printf unsafe > unsafe-command-executed.txt",
          },
        ],
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [forgeCli, "run"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).not.toBe(0);
    expect(
      result.stdout + result.stderr,
    ).toContain(
      "Plan rejected by FORGE Constitution",
    );

    expect(existsSync(markerFile)).toBe(false);
  });
});
