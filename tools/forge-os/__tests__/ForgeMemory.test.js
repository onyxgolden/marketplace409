import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ForgeMemory = require("../memory/ForgeMemory.js");

describe("ForgeMemory", () => {
  const temporaryRepositories = [];

  function createRepository() {
    const repoRoot = mkdtempSync(
      join(tmpdir(), "forge-memory-"),
    );

    temporaryRepositories.push(repoRoot);

    return repoRoot;
  }

  afterEach(() => {
    while (temporaryRepositories.length > 0) {
      rmSync(temporaryRepositories.pop(), {
        recursive: true,
        force: true,
      });
    }
  });

  it("starts with default memory when no file exists", () => {
    const memory = new ForgeMemory(createRepository());

    expect(memory.state).toEqual({
      runs: [],
      failures: {},
      successes: {},
      lastSignals: {
        biasInspect: 1,
        biasTest: 1,
        biasBuild: 1,
      },
    });
  });

  it("persists and reloads run history", () => {
    const repoRoot = createRepository();
    const memory = new ForgeMemory(repoRoot);

    memory.logRun("inspect repository", {
      steps: [{ action: "inspect" }],
    });

    const reloadedMemory = new ForgeMemory(repoRoot);

    expect(reloadedMemory.state.runs).toHaveLength(1);
    expect(reloadedMemory.state.runs[0]).toMatchObject({
      intent: "inspect repository",
      steps: 1,
    });

    expect(
      Number.isNaN(
        Date.parse(reloadedMemory.state.runs[0].timestamp),
      ),
    ).toBe(false);
  });

  it("tracks successful and failed actions", () => {
    const memory = new ForgeMemory(createRepository());

    memory.logSuccess({ action: "inspect" });
    memory.logSuccess({ action: "inspect" });
    memory.logFailure(
      { action: "run_tests" },
      new Error("test failure"),
    );

    expect(memory.state.successes).toEqual({
      inspect: 2,
    });

    expect(memory.state.failures).toEqual({
      run_tests: 1,
    });
  });

  it("reports current memory insights", () => {
    const memory = new ForgeMemory(createRepository());

    memory.logRun("status check", {
      steps: [
        { action: "inspect" },
        { action: "inspect" },
      ],
    });

    memory.logSuccess({ action: "inspect" });

    expect(memory.getInsights()).toEqual({
      mostFailingActions: {},
      mostSuccessfulActions: {
        inspect: 1,
      },
      totalRuns: 1,
      signals: {
        biasInspect: 1,
        biasTest: 1,
        biasBuild: 1,
      },
    });
  });

  it("updates optimization signals from action outcomes", () => {
    const memory = new ForgeMemory(createRepository());

    memory.logSuccess({ action: "inspect" });
    memory.logSuccess({ action: "run_tests" });
    memory.logFailure(
      { action: "build_project" },
      new Error("build failure"),
    );

    const signals = memory.updateOptimizationSignals();

    expect(signals).toEqual({
      biasInspect: 1.5,
      biasTest: 1.3,
      biasBuild: 0.6,
    });

    expect(memory.state.lastSignals).toEqual(signals);
  });

  it("writes valid JSON to the configured memory file", () => {
    const memory = new ForgeMemory(createRepository());

    memory.logSuccess({ action: "inspect" });

    const savedState = JSON.parse(
      readFileSync(memory.memoryFile, "utf8"),
    );

    expect(savedState).toEqual(memory.state);
  });
});
