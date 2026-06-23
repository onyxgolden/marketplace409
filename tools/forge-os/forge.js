#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ForgePlanner = require("./planner/ForgePlanner");
const ForgeMemory = require("./memory/ForgeMemory");

const repoRoot = process.cwd();
const PLAN_FILE = path.join(repoRoot, "tools/forge-os/.forge-plan.json");

/**
 * EXECUTE COMMAND
 */
function exec(cmd) {
  const res = spawnSync(cmd, {
    shell: true,
    cwd: repoRoot,
    encoding: "utf8",
  });

  return {
    ok: res.status === 0,
    out: res.stdout || "",
    err: res.stderr || "",
  };
}

/**
 * FORMAT OUTPUT (CLEAN)
 */
function printSection(title) {
  console.log("\n=========================");
  console.log(title);
  console.log("=========================\n");
}

/**
 * PLAN MODE
 */
function plan(intent) {
  const planner = new ForgePlanner();
  const memory = new ForgeMemory(repoRoot);

  const plan = planner.generatePlan(intent);

  memory.logRun(intent, plan);

  fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));

  printSection("FORGE PLAN (STABLE MODE)");

  console.log("Objective:", plan.objective);
  console.log("Phase:", plan.phase);

  console.log("\n--- STRATEGY ---");

  plan.steps.forEach((s, i) => {
    console.log(`\n[${i + 1}] ${s.action}`);
    console.log("Description:", s.description);
    if (s.command) console.log("Command:", s.command);
  });

  printSection("END PLAN");
}

/**
 * RUN MODE
 */
function run() {
  if (!fs.existsSync(PLAN_FILE)) {
    console.log("No plan found. Run 'plan' first.");
    return;
  }

  const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
  const memory = new ForgeMemory(repoRoot);

  printSection("FORGE EXECUTION (STABLE MODE)");

  let i = 0;

  while (i < plan.steps.length) {
    const step = plan.steps[i];

    console.log(`\n[Step ${i + 1}] ${step.action}`);
    console.log(step.description);

    if (step.command) {
      console.log("→", step.command);

      const result = exec(step.command);

      if (result.out) console.log(result.out);
      if (result.err) console.log(result.err);

      if (result.ok) {
        memory.logSuccess(step);
      } else {
        memory.logFailure(step, result.err || result.out);
      }
    }

    i++;
  }

  printSection("EXECUTION COMPLETE");
}

/**
 * ENTRY
 */
function main() {
  const mode = process.argv[2];
  const input = process.argv.slice(3).join(" ");

  if (mode === "plan") return plan(input);
  if (mode === "run") return run();

  console.log("Usage:");
  console.log("  plan <intent>");
  console.log("  run");
}

main();
