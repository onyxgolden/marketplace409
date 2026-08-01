import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ForgePlanner = require("../planner/ForgePlanner.js");

describe("ForgePlanner", () => {
  let originalWorkingDirectory;
  let repositoryRoot;

  beforeEach(() => {
    originalWorkingDirectory = process.cwd();
    repositoryRoot = mkdtempSync(
      join(tmpdir(), "forge-planner-"),
    );

    mkdirSync(
      join(repositoryRoot, "tools/forge-os/memory"),
      { recursive: true },
    );

    writeFileSync(
      join(repositoryRoot, "package.json"),
      JSON.stringify({
        name: "forge-planner-test",
      }),
      "utf8",
    );

    process.chdir(repositoryRoot);
  });

  afterEach(() => {
    process.chdir(originalWorkingDirectory);

    rmSync(repositoryRoot, {
      recursive: true,
      force: true,
    });
  });

  it("creates a memory-aware plan", () => {
    const planner = new ForgePlanner();

    const plan = planner.generatePlan(
      "inspect repository status",
    );

    expect(plan).toMatchObject({
      version: 5,
      phase: "MEMORY-AWARE PLANNING",
      objective: "inspect repository status",
    });

    expect(plan.context.files).toContain(
      "package.json",
    );

    expect(plan.steps).toHaveLength(2);
  });

  it("defaults unknown intents to repository inspection", () => {
    const planner = new ForgePlanner();

    const plan = planner.generatePlan(
      "marketplace growth strategy",
    );

    expect(
      plan.steps.map((step) => step.command),
    ).toEqual([
      "git status",
      "find . -maxdepth 2 | head -n 50",
    ]);
  });

  it("records each generated plan once in memory", () => {
    const planner = new ForgePlanner();

    planner.generatePlan("status");

    expect(planner.memory.state.runs).toHaveLength(1);
    expect(planner.memory.state.runs[0]).toMatchObject({
      intent: "status",
      steps: 2,
    });
  });

  it("applies optimization weights to inspection steps", () => {
    const planner = new ForgePlanner();

    planner.memory.logSuccess({
      action: "inspect",
    });

    const plan = planner.generatePlan("status");

    expect(
      plan.steps.map((step) => step.weight),
    ).toEqual([1.5, 1.5]);
  });

  it("uses semantic actions for tests and builds", () => {
    const planner = new ForgePlanner();

    const plan = planner.generatePlan(
      "test and build project",
    );

    expect(
      plan.steps.map((step) => step.action),
    ).toEqual([
      "run_tests",
      "build_project",
    ]);
  });
});
