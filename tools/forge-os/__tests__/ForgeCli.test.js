import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
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

describe("FORGE OS CLI", () => {
  const temporaryRepositories = [];

  function createRepository() {
    const repositoryRoot = mkdtempSync(
      join(tmpdir(), "forge-cli-"),
    );

    temporaryRepositories.push(repositoryRoot);

    return repositoryRoot;
  }

  afterEach(() => {
    while (temporaryRepositories.length > 0) {
      rmSync(temporaryRepositories.pop(), {
        recursive: true,
        force: true,
      });
    }
  });

  it("records a planned run exactly once", () => {
    const repositoryRoot = createRepository();

    const result = spawnSync(
      process.execPath,
      [forgeCli, "plan", "status"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);

    const memoryFile = join(
      repositoryRoot,
      "tools/forge-os/memory/forge-memory.json",
    );

    const memory = JSON.parse(
      readFileSync(memoryFile, "utf8"),
    );

    expect(memory.runs).toHaveLength(1);
    expect(memory.runs[0]).toMatchObject({
      intent: "status",
      steps: 2,
    });
  });

  it("preserves planner optimization signal updates", () => {
    const repositoryRoot = createRepository();

    const memoryDirectory = join(
      repositoryRoot,
      "tools/forge-os/memory",
    );

    mkdirSync(memoryDirectory, {
      recursive: true,
    });

    writeFileSync(
      join(memoryDirectory, "forge-memory.json"),
      JSON.stringify({
        runs: [],
        failures: {},
        successes: {
          inspect: 2,
        },
        lastSignals: {
          biasInspect: 1,
          biasTest: 1,
          biasBuild: 1,
        },
      }),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      [forgeCli, "plan", "status"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);

    const memory = JSON.parse(
      readFileSync(
        join(memoryDirectory, "forge-memory.json"),
        "utf8",
      ),
    );

    expect(memory.lastSignals).toEqual({
      biasInspect: 1.5,
      biasTest: 1,
      biasBuild: 1,
    });
  });
});
