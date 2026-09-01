// Dry-run entry point (FORGE_BRAIN_AUTONOMOUS_REPAIR_DESIGN.md Section 16: "A repair dry-run entry point
// that prints the maximum allowed action and reason codes"). Consumes a single fixture-shaped scenario file
// and explains the decision -- it never edits anything, never touches Git, and never creates a PR, a
// deployment, or any credential; it is purely evaluateRepairAuthority.mjs wired to a file on disk.

import fs from "node:fs";
import path from "node:path";

import { validateRepairManifest, validateRepairAuthorityPolicy, validateRepairApproval, MalformedRepairContractError } from "./repairContracts.mjs";
import { evaluateRepairAuthority } from "./evaluateRepairAuthority.mjs";

function parseArgs(argv) {
  const args = { scenarioPath: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--scenario") args.scenarioPath = argv[++i];
    else if (!args.scenarioPath) args.scenarioPath = arg;
  }
  return args;
}

function loadScenario(scenarioPath) {
  if (!scenarioPath) {
    throw new Error("A scenario file is required: dryRunRepairAuthorityCli.mjs --scenario <path.json>");
  }
  const raw = fs.readFileSync(scenarioPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Scenario file is not valid JSON: ${error.message}`);
  }
  return parsed;
}

// Builds the evaluateRepairAuthority() input from a plain-JSON scenario, validating the manifest, policy,
// and (if present) approval through the real contracts first -- a scenario with a malformed manifest or
// policy fails closed here with a clear error, rather than reaching the evaluator with unchecked shape.
export function buildEvaluationInputFromScenario(scenario) {
  const manifest = validateRepairManifest(scenario.manifest);
  const policy = scenario.policy ? validateRepairAuthorityPolicy(scenario.policy) : null;
  const approval = scenario.approval ? validateRepairApproval(scenario.approval) : null;
  return {
    manifest,
    policy,
    changedPaths: scenario.changedPaths || [],
    actualDiffStats: scenario.actualDiffStats || null,
    testIntegritySignals: scenario.testIntegritySignals || {},
    validationResults: scenario.validationResults || {},
    approval,
    circuitBreakerState: scenario.circuitBreakerState || { attemptsForIncident: 0, openRepairs: 0 },
    now: scenario.now || new Date().toISOString(),
  };
}

function renderText(result) {
  return [
    `Repair:          ${result.repairId}`,
    `Policy version:  ${result.policyVersion}`,
    `Decision:        ${result.decision}`,
    `Reason codes:    ${result.reasonCodes.join(", ")}`,
    `Evaluated at:    ${result.evaluatedAt}`,
  ].join("\n");
}

export function runCli(argv, { cwd = process.cwd() } = {}) {
  const args = parseArgs(argv);
  const scenarioPath = args.scenarioPath && !path.isAbsolute(args.scenarioPath) ? path.join(cwd, args.scenarioPath) : args.scenarioPath;
  const scenario = loadScenario(scenarioPath);
  const evaluationInput = buildEvaluationInputFromScenario(scenario);
  const result = evaluateRepairAuthority(evaluationInput);
  return { result, output: args.json ? JSON.stringify(result, null, 2) : renderText(result) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { output } = runCli(process.argv.slice(2));
    console.log(output);
  } catch (error) {
    const isContractError = error instanceof MalformedRepairContractError;
    console.error(`${isContractError ? "Malformed scenario input" : "Dry run failed"}: ${error.message}`);
    process.exitCode = 1;
  }
}
