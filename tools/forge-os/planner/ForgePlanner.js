const fs = require("fs");
const path = require("path");

const ForgeMemory = require("../memory/ForgeMemory");

class ForgePlanner {
  constructor() {
    this.repoRoot = process.cwd();
    this.memory = new ForgeMemory(this.repoRoot);
  }

  generatePlan(intent) {
    const context = this.analyzeRepo();

    // 🔥 STEP 2 FIX: pull memory + signals
    const memory = this.memory.getInsights();
    const signals = this.memory.updateOptimizationSignals();

    const goals = this.inferGoals(intent, context, memory);

    const plan = {
      version: 5,
      phase: "MEMORY-AWARE PLANNING",
      objective: intent,
      context,
      memory,
      signals, // 🔥 IMPORTANT
      steps: this.buildExecutionGraph(goals, memory, signals),
    };

    this.memory.logRun(intent, plan);

    return plan;
  }

  analyzeRepo() {
    try {
      return {
        files: fs.readdirSync(this.repoRoot).slice(0, 50),
      };
    } catch (e) {
      return { files: [] };
    }
  }

  inferGoals(intent, context, memory) {
    const goals = [];
    const lower = intent.toLowerCase();

    const f = memory.mostFailingActions || {};

    if (lower.includes("status")) goals.push("inspect_repo");
    if (lower.includes("test")) goals.push("run_tests");
    if (lower.includes("build")) goals.push("build_project");

    if (goals.length === 0) goals.push("inspect_repo");

    // memory influence
    if ((f.inspect || 0) > (f.run_tests || 0)) {
      goals.unshift("inspect_repo");
    }

    return goals;
  }

  buildExecutionGraph(goals, memory, signals) {
    const steps = [];

    for (const goal of goals) {
      switch (goal) {
        case "inspect_repo":
          steps.push(
            {
              action: "inspect",
              description: "Repo status",
              command: "git status",
              weight: signals.biasInspect
            },
            {
              action: "inspect",
              description: "Repo structure",
              command: "find . -maxdepth 2 | head -n 50",
              weight: signals.biasInspect
            }
          );
          break;

        case "run_tests":
          steps.push({
            action: "run_tests",
            description: "Run tests",
            command: "npm test",
            weight: signals.biasTest
          });
          break;

        case "build_project":
          steps.push({
            action: "build_project",
            description: "Build project",
            command: "npm run build",
            weight: signals.biasBuild
          });
          break;
      }
    }

    return steps;
  }
}

module.exports = ForgePlanner;
