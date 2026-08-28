import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli, buildEvaluationInputFromScenario } from "../dryRunRepairAuthorityCli.mjs";
import { MalformedRepairContractError, AUTHORITY_DECISION } from "../repairContracts.mjs";

const NOW = "2026-08-28T12:00:00.000Z";

function baseScenario(overrides = {}) {
  return {
    manifest: {
      manifestVersion: "1.0", repairId: "repair-1", incidentId: "incident-1", baseSha: "abc123",
      objective: "Fix the failing test.", hypothesis: "A typo.", repairClass: "narrow-regression",
      requestedAuthority: 2, effectiveAuthority: 2, allowedPaths: ["src/foo.js"], forbiddenPaths: [],
      maxFilesChanged: 3, maxLinesAdded: 20, maxLinesDeleted: 20, focusedValidation: [], broadValidation: [],
      protectedDomainFlags: [], rollbackPlan: "git checkout -- src/foo.js", expiresAt: "2026-08-29T00:00:00.000Z",
    },
    policy: {
      policyVersion: "1.0", defaultLevel: 1,
      repairClasses: {
        "narrow-regression": {
          maxLevel: 2, requiredChecks: [], allowedPaths: ["src/**"], forbiddenPaths: [],
          minimumSuccessfulSupervisedRuns: 0, requiresOwnerApproval: false,
        },
      },
      protectedOperations: ["database_migration"],
      circuitBreaker: { maximumAttemptsPerIncident: 2, maximumOpenRepairs: 1, stopOnInfrastructureUncertainty: true },
    },
    changedPaths: ["src/foo.js"],
    validationResults: { buildPassed: true, focusedPassed: true, broadPassed: true, newFailuresBeyondBaseline: 0 },
    now: NOW,
    ...overrides,
  };
}

let tmpDir;
function writeScenario(scenario) {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repair-controller-cli-test-"));
  const scenarioPath = path.join(tmpDir, "scenario.json");
  fs.writeFileSync(scenarioPath, JSON.stringify(scenario), "utf8");
  return scenarioPath;
}

describe("buildEvaluationInputFromScenario", () => {
  it("validates the manifest and policy through the real contracts", () => {
    const input = buildEvaluationInputFromScenario(baseScenario());
    expect(input.manifest.repairId).toBe("repair-1");
    expect(input.policy.policyVersion).toBe("1.0");
  });

  it("fails closed on a malformed manifest in the scenario", () => {
    const scenario = baseScenario();
    delete scenario.manifest.repairId;
    expect(() => buildEvaluationInputFromScenario(scenario)).toThrow(MalformedRepairContractError);
  });

  it("treats a missing policy as no policy (not a malformed scenario) -- the evaluator itself rejects that", () => {
    const scenario = baseScenario({ policy: undefined });
    const input = buildEvaluationInputFromScenario(scenario);
    expect(input.policy).toBeNull();
  });
});

describe("dry-run CLI", () => {
  afterEach(() => { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("prints the maximum permitted decision and stable reason codes as text", () => {
    const scenarioPath = writeScenario(baseScenario());
    const { result, output } = runCli(["--scenario", scenarioPath]);
    expect(result.decision).toBe(AUTHORITY_DECISION.PREPARE_FOR_REVIEW);
    expect(output).toContain("Decision:");
    expect(output).toContain("PREPARE_FOR_REVIEW".toLowerCase());
  });

  it("prints machine-readable JSON when --json is passed", () => {
    const scenarioPath = writeScenario(baseScenario());
    const { output } = runCli(["--scenario", scenarioPath, "--json"]);
    const parsed = JSON.parse(output);
    expect(parsed.decision).toBe(AUTHORITY_DECISION.PREPARE_FOR_REVIEW);
    expect(Array.isArray(parsed.reasonCodes)).toBe(true);
  });

  it("accepts the scenario path as a bare positional argument", () => {
    const scenarioPath = writeScenario(baseScenario());
    const { result } = runCli([scenarioPath]);
    expect(result.decision).toBe(AUTHORITY_DECISION.PREPARE_FOR_REVIEW);
  });

  it("throws a clear error when no scenario is supplied", () => {
    expect(() => runCli([])).toThrow(/scenario file is required/i);
  });

  it("throws a clear error on invalid JSON rather than a raw parser stack trace", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "repair-controller-cli-test-"));
    const scenarioPath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(scenarioPath, "{ not valid json", "utf8");
    expect(() => runCli(["--scenario", scenarioPath])).toThrow(/not valid JSON/);
  });

  it("never mutates the scenario file or anything else on disk -- a pure read-and-print", () => {
    const scenarioPath = writeScenario(baseScenario());
    const before = fs.readFileSync(scenarioPath, "utf8");
    runCli(["--scenario", scenarioPath]);
    const after = fs.readFileSync(scenarioPath, "utf8");
    expect(after).toBe(before);
  });
});
