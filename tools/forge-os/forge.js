#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const PatchEngine = require("./patch-engine/PatchEngine");

const repoRoot = process.cwd();
const defaultTaskFile = path.join(
  repoRoot,
  "tools",
  "forge-os",
  "tasks",
  "forge-task.json"
);
const logDir = path.join(repoRoot, "tools", "forge-os", "logs");

const BLOCKED_PATTERNS = [
  /(^|\s)git\s+push(\s|$)/,
  /(^|\s)git\s+push\s+--force(\s|$)/,
  /(^|\s)rm\s+-rf(\s|$)/,
  /(^|\s)sudo\s+rm(\s|$)/,
  /(^|\s)chmod\s+-R\s+777(\s|$)/,
  /(^|\s)curl\s+.*\|\s*(sh|bash)(\s|$)/,
  /(^|\s)wget\s+.*\|\s*(sh|bash)(\s|$)/,
];

const APPROVAL_PATTERNS = [
  /(^|\s)git\s+commit(\s|$)/,
  /(^|\s)git\s+merge(\s|$)/,
  /(^|\s)npm\s+install(\s|$)/,
  /(^|\s)pnpm\s+install(\s|$)/,
  /(^|\s)npx\s+prisma\s+migrate(\s|$)/,
  /(^|\s)npm\s+run\s+build(\s|$)/,
];

function ensureLogDir() {
  fs.mkdirSync(logDir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function isInsideRepo(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`);
}

function loadPlan(taskFile) {
  if (!fs.existsSync(taskFile)) {
    throw new Error(`Task file not found: ${taskFile}`);
  }

  const raw = fs.readFileSync(taskFile, "utf8");
  const parsed = JSON.parse(raw);
  const steps = normalizeSteps(parsed);

  if (steps.length === 0) {
    throw new Error("Task file must contain commands[] or steps[].");
  }

  return {
    name: parsed.name || parsed.objective || "Forge Plan",
    phase: parsed.phase || "Unspecified Phase",
    objective: parsed.objective || parsed.name || "Unspecified Objective",
    repository: parsed.repository || "Unspecified Repository",
    steps,
  };
}

function normalizeSteps(plan) {
  if (Array.isArray(plan.commands)) {
    return plan.commands.map((item, index) => normalizeCommandItem(item, index));
  }

  if (Array.isArray(plan.steps)) {
    return plan.steps.map((step, index) => ({
      description:
        step.description || `${step.action || "step"} ${index + 1}`,
      command: step.command || null,
      action: step.action || "command",
      patch: step.patch || null,
    }));
  }

  return [];
}

function normalizeCommandItem(item, index) {
  if (typeof item === "string") {
    return {
      description: `Command ${index + 1}`,
      command: item,
      action: "command",
      patch: null,
    };
  }

  return {
    description: item.description || `Command ${index + 1}`,
    command: item.command,
    action: item.action || "command",
    patch: item.patch || null,
  };
}

function validateCommand(command) {
  if (!command || typeof command !== "string") {
    return {
      ok: false,
      reason: "Command must be a non-empty string.",
    };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        ok: false,
        reason: `Blocked command pattern: ${pattern}`,
      };
    }
  }

  return { ok: true };
}

function requiresApproval(command) {
  return APPROVAL_PATTERNS.some((pattern) => pattern.test(command));
}

function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function writeLog(logPath, entry) {
  fs.appendFileSync(logPath, `${JSON.stringify(entry, null, 2)}\n\n`);
}

async function executeCommandStep(step, index, logPath) {
  console.log(`$ ${step.command}`);

  const validation = validateCommand(step.command);
  if (!validation.ok) {
    console.log(`BLOCKED: ${validation.reason}`);
    writeLog(logPath, {
      index,
      description: step.description,
      action: step.action,
      command: step.command,
      status: "blocked",
      reason: validation.reason,
    });
    return false;
  }

  if (requiresApproval(step.command)) {
    const answer = await askQuestion(
      "This command requires approval. Type yes to continue: "
    );

    if (answer !== "yes") {
      console.log("Stopped by user.");
      writeLog(logPath, {
        index,
        description: step.description,
        action: step.action,
        command: step.command,
        status: "stopped_by_user",
      });
      return false;
    }
  }

  const result = spawnSync(step.command, {
    shell: true,
    cwd: repoRoot,
    encoding: "utf8",
  });

  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");

  writeLog(logPath, {
    index,
    description: step.description,
    action: step.action,
    command: step.command,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });

  if (result.status !== 0) {
    console.log(`FAILED at step ${index + 1}.`);
    return false;
  }

  return true;
}

function executePatchStep(step, index, logPath) {
  if (!step.patch) {
    console.log("BLOCKED: apply_patch step requires a patch path.");
    writeLog(logPath, {
      index,
      description: step.description,
      action: step.action,
      status: "blocked",
      reason: "Missing patch path.",
    });
    return false;
  }

  const patchPath = path.resolve(repoRoot, step.patch);

  if (!isInsideRepo(patchPath)) {
    console.log("BLOCKED: patch file must be inside repository.");
    writeLog(logPath, {
      index,
      description: step.description,
      action: step.action,
      patch: step.patch,
      status: "blocked",
      reason: "Patch file outside repository.",
    });
    return false;
  }

  const patchEngine = new PatchEngine(repoRoot);
  const patch = patchEngine.loadPatch(patchPath);
  const results = patchEngine.apply(patch);

  console.log(`Applied patch: ${step.patch}`);
  for (const result of results) {
    console.log(`- ${result.path}: ${result.status}, verified=${result.verified}`);
  }

  writeLog(logPath, {
    index,
    description: step.description,
    action: step.action,
    patch: step.patch,
    status: "passed",
    results,
  });

  return true;
}

async function main() {
  ensureLogDir();

  const taskFileArg = process.argv[2];
  const taskFile = taskFileArg ? path.resolve(taskFileArg) : defaultTaskFile;

  if (!isInsideRepo(taskFile)) {
    throw new Error("Task file must be inside the repository.");
  }

  const plan = loadPlan(taskFile);
  const logPath = path.join(logDir, `forge-run-${timestamp()}.log`);

  console.log("FORGE OS");
  console.log(`Repo: ${repoRoot}`);
  console.log(`Task: ${taskFile}`);
  console.log(`Phase: ${plan.phase}`);
  console.log(`Objective: ${plan.objective}`);
  console.log(`Log: ${logPath}`);
  console.log("");

  for (const [index, step] of plan.steps.entries()) {
    console.log(`Step ${index + 1}: ${step.description}`);
    console.log(`Action: ${step.action}`);

    let passed = false;

    if (step.action === "apply_patch") {
      passed = executePatchStep(step, index, logPath);
    } else {
      passed = await executeCommandStep(step, index, logPath);
    }

    if (!passed) {
      process.exitCode = 1;
      return;
    }

    console.log("");
  }

  console.log("FORGE OS execution complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
