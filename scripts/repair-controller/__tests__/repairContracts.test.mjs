import { describe, expect, it } from "vitest";
import {
  MalformedRepairContractError,
  INCIDENT_SOURCE, INCIDENT_ENVIRONMENT, INCIDENT_SEVERITY, INCIDENT_STATUS,
  EVIDENCE_STAGE, EVIDENCE_ACTOR_TYPE, EVIDENCE_RESULT, AUTHORITY_DECISION,
  validateRepairIncident, validateRepairManifest, validateRepairEvidence,
  validateRepairAuthorityPolicy, validateRepairApproval, validateRepairDecision,
  computeManifestHash,
} from "../repairContracts.mjs";

function validIncident(overrides = {}) {
  return {
    incidentId: "incident-1", source: INCIDENT_SOURCE.CI, sourceEventId: "run-1", detectedAt: "2026-08-28T00:00:00.000Z",
    repository: "onyxgolden/marketplace409", baseBranch: "main", observedSha: "abc123", environment: INCIDENT_ENVIRONMENT.LOCAL,
    severity: INCIDENT_SEVERITY.LOW, summary: "A test failed.", rawEvidenceRefs: ["ref-1"], normalizedEvidenceRef: "normalized-1",
    correlationKey: "correlation-1", status: INCIDENT_STATUS.OPEN, ...overrides,
  };
}

function validManifest(overrides = {}) {
  return {
    manifestVersion: "1.0", repairId: "repair-1", incidentId: "incident-1", baseSha: "abc123",
    objective: "Fix the failing test.", hypothesis: "A typo in an assertion.", repairClass: "narrow-regression",
    requestedAuthority: 2, effectiveAuthority: 1, allowedPaths: ["src/foo.js"], forbiddenPaths: ["supabase/migrations/**"],
    maxFilesChanged: 3, maxLinesAdded: 20, maxLinesDeleted: 20, focusedValidation: ["npx vitest run src/foo.test.js"],
    broadValidation: ["npx vitest run"], protectedDomainFlags: [], rollbackPlan: "git checkout -- src/foo.js",
    expiresAt: "2026-08-29T00:00:00.000Z", ...overrides,
  };
}

function validEvidence(overrides = {}) {
  return {
    repairId: "repair-1", stage: EVIDENCE_STAGE.VALIDATE, startedAt: "2026-08-28T00:00:00.000Z",
    actorType: EVIDENCE_ACTOR_TYPE.AGENT, actorId: "claude-session-1", inputs: [], outputs: [],
    commands: [{ command: "npx vitest run", exitCode: 0, redacted: true }], result: EVIDENCE_RESULT.PASS,
    reasonCodes: ["focused_tests_passed"], evidenceHash: "sha256:abcdef", ...overrides,
  };
}

function validPolicy(overrides = {}) {
  return {
    policyVersion: "1.0", defaultLevel: 1,
    repairClasses: {
      "narrow-regression": {
        maxLevel: 2, requiredChecks: ["focused_tests"], allowedPaths: ["src/**"], forbiddenPaths: ["supabase/migrations/**"],
        minimumSuccessfulSupervisedRuns: 3, requiresOwnerApproval: true,
      },
    },
    protectedOperations: ["database_migration", "rls_policy_change"],
    circuitBreaker: { maximumAttemptsPerIncident: 2, maximumOpenRepairs: 1, stopOnInfrastructureUncertainty: true },
    ...overrides,
  };
}

describe("validateRepairIncident", () => {
  it("accepts a well-formed incident", () => {
    const incident = validateRepairIncident(validIncident());
    expect(incident.incidentId).toBe("incident-1");
    expect(Object.isFrozen(incident)).toBe(true);
  });

  it("fails closed on an unknown source", () => {
    expect(() => validateRepairIncident(validIncident({ source: "telepathy" }))).toThrow(MalformedRepairContractError);
  });

  it("fails closed on an unknown severity", () => {
    expect(() => validateRepairIncident(validIncident({ severity: "apocalyptic" }))).toThrow(MalformedRepairContractError);
  });

  it("fails closed on a missing observedSha", () => {
    expect(() => validateRepairIncident(validIncident({ observedSha: "" }))).toThrow(MalformedRepairContractError);
  });

  it("fails closed when rawEvidenceRefs contains a non-string", () => {
    expect(() => validateRepairIncident(validIncident({ rawEvidenceRefs: [42] }))).toThrow(MalformedRepairContractError);
  });
});

describe("validateRepairManifest", () => {
  it("accepts a well-formed manifest", () => {
    const manifest = validateRepairManifest(validManifest());
    expect(manifest.repairId).toBe("repair-1");
    expect(Object.isFrozen(manifest.allowedPaths)).toBe(true);
  });

  it("fails closed when effectiveAuthority exceeds requestedAuthority", () => {
    expect(() => validateRepairManifest(validManifest({ requestedAuthority: 1, effectiveAuthority: 2 })))
      .toThrow(/effectiveAuthority cannot exceed requestedAuthority/);
  });

  it("fails closed on an out-of-range authority level", () => {
    expect(() => validateRepairManifest(validManifest({ requestedAuthority: 5 }))).toThrow(MalformedRepairContractError);
    expect(() => validateRepairManifest(validManifest({ effectiveAuthority: -1 }))).toThrow(MalformedRepairContractError);
  });

  it("fails closed on a negative budget", () => {
    expect(() => validateRepairManifest(validManifest({ maxFilesChanged: -1 }))).toThrow(MalformedRepairContractError);
  });
});

describe("validateRepairEvidence", () => {
  it("accepts well-formed, redacted evidence", () => {
    const evidence = validateRepairEvidence(validEvidence());
    expect(evidence.result).toBe(EVIDENCE_RESULT.PASS);
  });

  it("fails closed on an unredacted command -- evidence must never carry raw command output", () => {
    expect(() => validateRepairEvidence(validEvidence({
      commands: [{ command: "npx vitest run", exitCode: 0, redacted: false }],
    }))).toThrow(/redacted/);
  });

  it("fails closed on an unknown stage", () => {
    expect(() => validateRepairEvidence(validEvidence({ stage: "teleport" }))).toThrow(MalformedRepairContractError);
  });

  it("fails closed on an unknown actorType", () => {
    expect(() => validateRepairEvidence(validEvidence({ actorType: "ghost" }))).toThrow(MalformedRepairContractError);
  });
});

describe("validateRepairAuthorityPolicy", () => {
  it("accepts a well-formed policy", () => {
    const policy = validateRepairAuthorityPolicy(validPolicy());
    expect(policy.repairClasses["narrow-regression"].maxLevel).toBe(2);
  });

  it("fails closed on a defaultLevel other than 1 -- a policy cannot promote itself", () => {
    expect(() => validateRepairAuthorityPolicy(validPolicy({ defaultLevel: 3 }))).toThrow(/defaultLevel must be exactly 1/);
    expect(() => validateRepairAuthorityPolicy(validPolicy({ defaultLevel: 0 }))).toThrow(/defaultLevel must be exactly 1/);
  });

  it("fails closed on a malformed repair-class entry", () => {
    expect(() => validateRepairAuthorityPolicy(validPolicy({
      repairClasses: { "bad-class": { maxLevel: 2 } },
    }))).toThrow(MalformedRepairContractError);
  });

  it("fails closed on a missing circuitBreaker field", () => {
    expect(() => validateRepairAuthorityPolicy(validPolicy({
      circuitBreaker: { maximumAttemptsPerIncident: 2, maximumOpenRepairs: 1 },
    }))).toThrow(MalformedRepairContractError);
  });
});

describe("validateRepairApproval", () => {
  it("accepts a well-formed approval", () => {
    const approval = validateRepairApproval({
      approverId: "jasonmorgan99@gmail.com", manifestHash: "sha256:abc", baseSha: "abc123",
      maxAuthority: 2, grantedAt: "2026-08-28T00:00:00.000Z", expiresAt: "2026-08-29T00:00:00.000Z",
    });
    expect(approval.maxAuthority).toBe(2);
  });

  it("fails closed on a missing manifestHash", () => {
    expect(() => validateRepairApproval({
      approverId: "x", baseSha: "abc123", maxAuthority: 2, grantedAt: "t", expiresAt: "t",
    })).toThrow(MalformedRepairContractError);
  });
});

describe("validateRepairDecision", () => {
  it("accepts a well-formed decision", () => {
    const decision = validateRepairDecision({
      repairId: "repair-1", policyVersion: "1.0", decision: AUTHORITY_DECISION.ESCALATE,
      reasonCodes: ["protected_domain_touched"], evaluatedAt: "2026-08-28T00:00:00.000Z",
    });
    expect(decision.decision).toBe("escalate");
  });

  it("fails closed on an unknown decision value", () => {
    expect(() => validateRepairDecision({
      repairId: "repair-1", policyVersion: "1.0", decision: "auto_yolo_merge",
      reasonCodes: ["x"], evaluatedAt: "t",
    })).toThrow(MalformedRepairContractError);
  });

  it("fails closed when reasonCodes is empty -- a decision must always be explainable", () => {
    expect(() => validateRepairDecision({
      repairId: "repair-1", policyVersion: "1.0", decision: AUTHORITY_DECISION.REJECT,
      reasonCodes: [], evaluatedAt: "t",
    })).toThrow(/reasonCodes/);
  });
});

describe("computeManifestHash", () => {
  it("is deterministic for identical manifest content", () => {
    const manifest = validateRepairManifest(validManifest());
    expect(computeManifestHash(manifest)).toBe(computeManifestHash(validateRepairManifest(validManifest())));
  });

  it("changes when any manifest field changes", () => {
    const manifest = validateRepairManifest(validManifest());
    const changed = validateRepairManifest(validManifest({ objective: "A different objective." }));
    expect(computeManifestHash(manifest)).not.toBe(computeManifestHash(changed));
  });
});
