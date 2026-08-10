import {
  execFileSync,
  spawnSync,
} from "node:child_process";

import path from "node:path";
import { pathToFileURL } from "node:url";

import { runGovernancePipeline } from "./runGovernancePipeline.mjs";
import { evaluatePromotionEligibility } from "./evaluatePromotionEligibility.mjs";
import { evaluateGovernanceEvolutionReadiness } from "./evaluateGovernanceEvolutionReadiness.mjs";
import { evaluateGovernanceEvolutionDecision } from "./evaluateGovernanceEvolutionDecision.mjs";
import { buildEvolutionReviewContext } from "./buildEvolutionReviewContext.mjs";
import { buildPromotionEvaluationContext } from "./buildPromotionEvaluationContext.mjs";
import { runConversationPreparation } from "../conversation/runConversationPreparation.mjs";

export const ENGINEERING_SESSION_VERSION = "1.0";

export const ENGINEERING_SESSION_ORDER = Object.freeze([
  "repositoryInspection",
  "governancePipeline",
  "sessionEvidence",
  "promotionEvaluation",
  "evolutionReadiness",
  "evolutionDecision",
  "evolutionReviewContext",
  "conversationPreparation",
]);

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertPlainObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertFunction(value, label) {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function`);
  }
}

function deepFreeze(value) {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}

function runGit(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
}

function parseStatusLines(statusOutput) {
  if (!statusOutput) {
    return [];
  }

  return statusOutput
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export function inspectEngineeringRepository({
  repositoryRoot = process.cwd(),
} = {}) {
  assertNonEmptyString(repositoryRoot, "repositoryRoot");

  const normalizedRepositoryRoot = path.resolve(repositoryRoot);

  const branch = runGit(normalizedRepositoryRoot, ["branch", "--show-current"]);
  const head = runGit(normalizedRepositoryRoot, ["rev-parse", "HEAD"]);
  const originMain = runGit(normalizedRepositoryRoot, ["rev-parse", "origin/main"]);

  const statusLines = parseStatusLines(
    runGit(normalizedRepositoryRoot, ["status", "--short"]),
  );

  return deepFreeze({
    repositoryRoot: normalizedRepositoryRoot,
    branch,
    head,
    originMain,
    headMatchesOriginMain: head === originMain,
    workingTreeClean: statusLines.length === 0,
    modifiedFiles: statusLines.map((line) =>
      line.length > 3 ? line.slice(3) : line,
    ),
    gitStatus: [...statusLines],
  });
}

export function collectEngineeringSessionEvidence({
  repositoryRoot = process.cwd(),
  scriptPath = "scripts/governance/collectSessionEvidence.mjs",
  reviewedMetadataPath = null,
} = {}) {
  assertNonEmptyString(repositoryRoot, "repositoryRoot");
  assertNonEmptyString(scriptPath, "scriptPath");

  const normalizedRepositoryRoot = path.resolve(repositoryRoot);

  const collectorArgs = [
    path.resolve(normalizedRepositoryRoot, scriptPath),
  ];

  if (reviewedMetadataPath !== null) {
    assertNonEmptyString(reviewedMetadataPath, "reviewedMetadataPath");
    collectorArgs.push(reviewedMetadataPath);
  }

  const result = spawnSync(process.execPath, collectorArgs, {
    cwd: normalizedRepositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n");

    throw new Error(
      `Session evidence collection failed${detail ? `: ${detail}` : ""}`,
    );
  }

  return deepFreeze({
    status: "completed",
    exitCode: result.status,
    stdout: result.stdout.trimEnd(),
    stderr: result.stderr.trimEnd(),
  });
}

function runPromotionEvaluation({
  repositoryRoot,
  repositoryEvidence,
  evaluationEvidence,
  buildPromotionEvaluationContextFn,
  evaluatePromotionEligibilityFn,
}) {
  const promotionEvaluationContext = buildPromotionEvaluationContextFn({
    repositoryRoot,
    repositoryEvidence,
    evaluationEvidence,
  });

  assertPlainObject(promotionEvaluationContext, "promotionEvaluationContext");

  return evaluatePromotionEligibilityFn(promotionEvaluationContext);
}

export function runEngineeringSession({
  repositoryRoot = process.cwd(),
  governancePipelineOptions = {},
  conversationPreparationOptions = {},
  promotionEvaluationEvidence,
  reviewedMetadataPath = null,
  inspectRepositoryFn = inspectEngineeringRepository,
  runGovernancePipelineFn = runGovernancePipeline,
  collectSessionEvidenceFn = collectEngineeringSessionEvidence,
  buildPromotionEvaluationContextFn = buildPromotionEvaluationContext,
  evaluatePromotionEligibilityFn = evaluatePromotionEligibility,
  evaluateGovernanceEvolutionReadinessFn = evaluateGovernanceEvolutionReadiness,
  evaluateGovernanceEvolutionDecisionFn = evaluateGovernanceEvolutionDecision,
  buildEvolutionReviewContextFn = buildEvolutionReviewContext,
  runConversationPreparationFn = runConversationPreparation,
} = {}) {
  assertNonEmptyString(repositoryRoot, "repositoryRoot");
  assertPlainObject(governancePipelineOptions, "governancePipelineOptions");
  assertPlainObject(
    conversationPreparationOptions,
    "conversationPreparationOptions",
  );
  assertFunction(inspectRepositoryFn, "inspectRepositoryFn");
  assertFunction(runGovernancePipelineFn, "runGovernancePipelineFn");
  assertFunction(collectSessionEvidenceFn, "collectSessionEvidenceFn");
  assertFunction(
    evaluatePromotionEligibilityFn,
    "evaluatePromotionEligibilityFn",
  );
  assertFunction(
    evaluateGovernanceEvolutionReadinessFn,
    "evaluateGovernanceEvolutionReadinessFn",
  );
  assertFunction(
    evaluateGovernanceEvolutionDecisionFn,
    "evaluateGovernanceEvolutionDecisionFn",
  );
  assertFunction(buildEvolutionReviewContextFn, "buildEvolutionReviewContextFn");
  assertFunction(runConversationPreparationFn, "runConversationPreparationFn");

  if (reviewedMetadataPath !== null) {
    assertNonEmptyString(reviewedMetadataPath, "reviewedMetadataPath");
  }

  const normalizedRepositoryRoot = path.resolve(repositoryRoot);

  const repository = inspectRepositoryFn({
    repositoryRoot: normalizedRepositoryRoot,
  });

  const governance = runGovernancePipelineFn({ ...governancePipelineOptions });

  const evidence = collectSessionEvidenceFn({
    repositoryRoot: normalizedRepositoryRoot,
    reviewedMetadataPath,
  });

  const promotion = runPromotionEvaluation({
    repositoryRoot: normalizedRepositoryRoot,
    repositoryEvidence: repository,
    evaluationEvidence: promotionEvaluationEvidence,
    buildPromotionEvaluationContextFn,
    evaluatePromotionEligibilityFn,
  });

  const evolutionReadiness = evaluateGovernanceEvolutionReadinessFn({
    repository,
    governance,
    evidence,
    promotion,
  });

  const evolutionDecision = evaluateGovernanceEvolutionDecisionFn({
    repository,
    governance,
    evidence,
    promotion,
    evolutionReadiness,
  });

  const evolutionReviewContext = buildEvolutionReviewContextFn({
    repositoryEvidence: repository,
    governanceState: governance,
    validationEvidence: evidence,
    promotionEvaluation: promotion,
    evolutionReadiness,
    evolutionDecision,
  });

  const conversation = runConversationPreparationFn({
    ...conversationPreparationOptions,
    engineeringState: {
      repository,
      evolutionReadiness,
      evolutionReviewContext,
    },
  });

  return deepFreeze({
    version: ENGINEERING_SESSION_VERSION,
    status: "completed",
    repositoryRoot: normalizedRepositoryRoot,
    executionOrder: [...ENGINEERING_SESSION_ORDER],
    repository,
    governance,
    evidence,
    promotion,
    evolutionReadiness,
    evolutionDecision,
    evolutionReviewContext,
    conversation,
  });
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  return (
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  );
}

if (isDirectExecution()) {
  try {
    const validationEvidencePath = process.argv[2];

    if (!validationEvidencePath) {
      throw new Error(
        "Usage: node scripts/governance/runEngineeringSession.mjs <validation-evidence-path>",
      );
    }

    const result = runEngineeringSession({
      governancePipelineOptions: { validationEvidencePath },
    });

    console.log("FORGE ENGINEERING SESSION COMPLETED");
    console.log(`Version: ${result.version}`);
    console.log(`Execution order: ${result.executionOrder.join(" -> ")}`);
    console.log(`Branch: ${result.repository.branch}`);
    console.log(
      `HEAD matches origin/main: ${result.repository.headMatchesOriginMain ? "yes" : "no"}`,
    );
    console.log(
      `Working tree: ${result.repository.workingTreeClean ? "clean" : "dirty"}`,
    );
  } catch (error) {
    console.error(`FORGE ENGINEERING SESSION FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}
