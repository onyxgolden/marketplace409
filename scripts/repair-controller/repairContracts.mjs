// Versioned, runtime-validated contracts for the Autonomous Repair Controller (FORGE_BRAIN_AUTONOMOUS_REPAIR_
// DESIGN.md Section 5 "Canonical data contracts"). Every shape here mirrors that document's TypeScript types
// field-for-field, plus two contracts the document implies but doesn't literally type (Approval and Decision --
// Sections 6.H and 10 both describe their required fields in prose). Validation fails closed: an unknown or
// malformed field is rejected here, at the boundary, rather than silently accepted and discovered later inside
// the authority evaluator -- this is what Phase AR-1's own acceptance criteria means by "missing/unknown fields
// fail closed."

import { hashContent } from "../engineering-brain/hashContent.mjs";

export const REPAIR_CONTRACTS_SCHEMA_VERSION = "1.0";

// A stable content hash of a validated manifest -- what an approval record binds to (Section 10:
// "Approval records must bind the approver, manifest hash, base SHA, maximum authority, and expiration"),
// and what invalidates that approval the instant the manifest changes in any way. validateRepairManifest
// always constructs its returned object with the same key order, so JSON.stringify is deterministic here
// without needing a separate canonicalization step.
export function computeManifestHash(manifest) {
  return `sha256:${hashContent(JSON.stringify(manifest))}`;
}

export class MalformedRepairContractError extends Error {
  constructor(contractName, reason) {
    super(`Malformed ${contractName}: ${reason}`);
    this.name = "MalformedRepairContractError";
    this.contractName = contractName;
    this.reason = reason;
  }
}

export const INCIDENT_SOURCE = Object.freeze({
  CI: "ci", RUNTIME: "runtime", HEALTH_CHECK: "health_check", CRON: "cron", SECURITY: "security", MANUAL: "manual",
});

export const INCIDENT_ENVIRONMENT = Object.freeze({ LOCAL: "local", PREVIEW: "preview", PRODUCTION: "production" });

export const INCIDENT_SEVERITY = Object.freeze({ LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" });

export const INCIDENT_STATUS = Object.freeze({
  OPEN: "open", DIAGNOSING: "diagnosing", REPAIRING: "repairing", AWAITING_APPROVAL: "awaiting_approval",
  MONITORING: "monitoring", RESOLVED: "resolved", ESCALATED: "escalated",
});

export const EVIDENCE_STAGE = Object.freeze({
  COLLECT: "collect", DIAGNOSE: "diagnose", PLAN: "plan", EDIT: "edit", VALIDATE: "validate",
  AUTHORIZE: "authorize", INTEGRATE: "integrate", DEPLOY: "deploy", MONITOR: "monitor", ROLLBACK: "rollback",
});

export const EVIDENCE_ACTOR_TYPE = Object.freeze({ HUMAN: "human", AGENT: "agent", SERVICE: "service" });

export const EVIDENCE_RESULT = Object.freeze({ PASS: "pass", FAIL: "fail", BLOCKED: "blocked", ESCALATED: "escalated" });

export const AUTHORITY_DECISION = Object.freeze({
  REJECT: "reject", DIAGNOSIS_COMPLETE: "diagnosis_complete", PREPARE_FOR_REVIEW: "prepare_for_review",
  CREATE_PR: "create_pr", MERGE: "merge", DEPLOY: "deploy", ROLLBACK: "rollback", ESCALATE: "escalate",
});

function fail(contractName, reason) {
  throw new MalformedRepairContractError(contractName, reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isAuthorityLevel(value) {
  return Number.isInteger(value) && value >= 0 && value <= 4;
}

export function validateRepairIncident(incident) {
  if (!isPlainObject(incident)) fail("RepairIncident", "must be an object");
  if (!isNonEmptyString(incident.incidentId)) fail("RepairIncident", "incidentId must be a non-empty string");
  if (!Object.values(INCIDENT_SOURCE).includes(incident.source)) {
    fail("RepairIncident", `source must be one of ${Object.values(INCIDENT_SOURCE).join(", ")}`);
  }
  if (!isNonEmptyString(incident.sourceEventId)) fail("RepairIncident", "sourceEventId must be a non-empty string");
  if (!isNonEmptyString(incident.detectedAt)) fail("RepairIncident", "detectedAt must be a non-empty string");
  if (!isNonEmptyString(incident.repository)) fail("RepairIncident", "repository must be a non-empty string");
  if (!isNonEmptyString(incident.baseBranch)) fail("RepairIncident", "baseBranch must be a non-empty string");
  if (!isNonEmptyString(incident.observedSha)) fail("RepairIncident", "observedSha must be a non-empty string");
  if (!Object.values(INCIDENT_ENVIRONMENT).includes(incident.environment)) {
    fail("RepairIncident", `environment must be one of ${Object.values(INCIDENT_ENVIRONMENT).join(", ")}`);
  }
  if (!Object.values(INCIDENT_SEVERITY).includes(incident.severity)) {
    fail("RepairIncident", `severity must be one of ${Object.values(INCIDENT_SEVERITY).join(", ")}`);
  }
  if (!isNonEmptyString(incident.summary)) fail("RepairIncident", "summary must be a non-empty string");
  if (!isStringArray(incident.rawEvidenceRefs)) fail("RepairIncident", "rawEvidenceRefs must be an array of strings");
  if (!isNonEmptyString(incident.normalizedEvidenceRef)) fail("RepairIncident", "normalizedEvidenceRef must be a non-empty string");
  if (!isNonEmptyString(incident.correlationKey)) fail("RepairIncident", "correlationKey must be a non-empty string");
  if (!Object.values(INCIDENT_STATUS).includes(incident.status)) {
    fail("RepairIncident", `status must be one of ${Object.values(INCIDENT_STATUS).join(", ")}`);
  }
  return Object.freeze({
    incidentId: incident.incidentId, source: incident.source, sourceEventId: incident.sourceEventId,
    detectedAt: incident.detectedAt, repository: incident.repository, baseBranch: incident.baseBranch,
    observedSha: incident.observedSha, environment: incident.environment, severity: incident.severity,
    summary: incident.summary, rawEvidenceRefs: Object.freeze([...incident.rawEvidenceRefs]),
    normalizedEvidenceRef: incident.normalizedEvidenceRef, correlationKey: incident.correlationKey,
    status: incident.status,
  });
}

export function validateRepairManifest(manifest) {
  if (!isPlainObject(manifest)) fail("RepairManifest", "must be an object");
  if (!isNonEmptyString(manifest.manifestVersion)) fail("RepairManifest", "manifestVersion must be a non-empty string");
  if (!isNonEmptyString(manifest.repairId)) fail("RepairManifest", "repairId must be a non-empty string");
  if (!isNonEmptyString(manifest.incidentId)) fail("RepairManifest", "incidentId must be a non-empty string");
  if (!isNonEmptyString(manifest.baseSha)) fail("RepairManifest", "baseSha must be a non-empty string");
  if (!isNonEmptyString(manifest.objective)) fail("RepairManifest", "objective must be a non-empty string");
  if (!isNonEmptyString(manifest.hypothesis)) fail("RepairManifest", "hypothesis must be a non-empty string");
  if (!isNonEmptyString(manifest.repairClass)) fail("RepairManifest", "repairClass must be a non-empty string");
  if (!isAuthorityLevel(manifest.requestedAuthority)) fail("RepairManifest", "requestedAuthority must be an integer 0-4");
  if (!isAuthorityLevel(manifest.effectiveAuthority)) fail("RepairManifest", "effectiveAuthority must be an integer 0-4");
  // Effective authority must never exceed requested authority -- otherwise a manifest could claim a
  // *lower* request while somehow being granted more, which would make "requested" meaningless as a cap.
  if (manifest.effectiveAuthority > manifest.requestedAuthority) {
    fail("RepairManifest", "effectiveAuthority cannot exceed requestedAuthority");
  }
  if (!isStringArray(manifest.allowedPaths)) fail("RepairManifest", "allowedPaths must be an array of strings");
  if (!isStringArray(manifest.forbiddenPaths)) fail("RepairManifest", "forbiddenPaths must be an array of strings");
  if (!Number.isInteger(manifest.maxFilesChanged) || manifest.maxFilesChanged < 0) {
    fail("RepairManifest", "maxFilesChanged must be a non-negative integer");
  }
  if (!Number.isInteger(manifest.maxLinesAdded) || manifest.maxLinesAdded < 0) {
    fail("RepairManifest", "maxLinesAdded must be a non-negative integer");
  }
  if (!Number.isInteger(manifest.maxLinesDeleted) || manifest.maxLinesDeleted < 0) {
    fail("RepairManifest", "maxLinesDeleted must be a non-negative integer");
  }
  if (!isStringArray(manifest.focusedValidation)) fail("RepairManifest", "focusedValidation must be an array of strings");
  if (!isStringArray(manifest.broadValidation)) fail("RepairManifest", "broadValidation must be an array of strings");
  if (!isStringArray(manifest.protectedDomainFlags)) fail("RepairManifest", "protectedDomainFlags must be an array of strings");
  if (!isNonEmptyString(manifest.rollbackPlan)) fail("RepairManifest", "rollbackPlan must be a non-empty string");
  if (!isNonEmptyString(manifest.expiresAt)) fail("RepairManifest", "expiresAt must be a non-empty string");
  return Object.freeze({
    manifestVersion: manifest.manifestVersion, repairId: manifest.repairId, incidentId: manifest.incidentId,
    baseSha: manifest.baseSha, objective: manifest.objective, hypothesis: manifest.hypothesis,
    repairClass: manifest.repairClass, requestedAuthority: manifest.requestedAuthority,
    effectiveAuthority: manifest.effectiveAuthority, allowedPaths: Object.freeze([...manifest.allowedPaths]),
    forbiddenPaths: Object.freeze([...manifest.forbiddenPaths]), maxFilesChanged: manifest.maxFilesChanged,
    maxLinesAdded: manifest.maxLinesAdded, maxLinesDeleted: manifest.maxLinesDeleted,
    focusedValidation: Object.freeze([...manifest.focusedValidation]), broadValidation: Object.freeze([...manifest.broadValidation]),
    protectedDomainFlags: Object.freeze([...manifest.protectedDomainFlags]), rollbackPlan: manifest.rollbackPlan,
    expiresAt: manifest.expiresAt,
  });
}

function validateRedactedCommandEvidence(command, index) {
  if (!isPlainObject(command)) fail("RepairEvidence", `commands[${index}] must be an object`);
  if (!isNonEmptyString(command.command)) fail("RepairEvidence", `commands[${index}].command must be a non-empty string`);
  if (typeof command.exitCode !== "number") fail("RepairEvidence", `commands[${index}].exitCode must be a number`);
  if (command.redacted !== true) {
    fail("RepairEvidence", `commands[${index}].redacted must be true -- command evidence must be redacted before it reaches this contract`);
  }
  return Object.freeze({ command: command.command, exitCode: command.exitCode, redacted: true });
}

export function validateRepairEvidence(evidence) {
  if (!isPlainObject(evidence)) fail("RepairEvidence", "must be an object");
  if (!isNonEmptyString(evidence.repairId)) fail("RepairEvidence", "repairId must be a non-empty string");
  if (!Object.values(EVIDENCE_STAGE).includes(evidence.stage)) {
    fail("RepairEvidence", `stage must be one of ${Object.values(EVIDENCE_STAGE).join(", ")}`);
  }
  if (!isNonEmptyString(evidence.startedAt)) fail("RepairEvidence", "startedAt must be a non-empty string");
  if (evidence.completedAt !== undefined && evidence.completedAt !== null && typeof evidence.completedAt !== "string") {
    fail("RepairEvidence", "completedAt must be a string or null when present");
  }
  if (!Object.values(EVIDENCE_ACTOR_TYPE).includes(evidence.actorType)) {
    fail("RepairEvidence", `actorType must be one of ${Object.values(EVIDENCE_ACTOR_TYPE).join(", ")}`);
  }
  if (!isNonEmptyString(evidence.actorId)) fail("RepairEvidence", "actorId must be a non-empty string");
  if (evidence.canonicalOwnerId !== undefined && evidence.canonicalOwnerId !== null && typeof evidence.canonicalOwnerId !== "string") {
    fail("RepairEvidence", "canonicalOwnerId must be a string or null when present");
  }
  if (!isStringArray(evidence.inputs)) fail("RepairEvidence", "inputs must be an array of strings");
  if (!isStringArray(evidence.outputs)) fail("RepairEvidence", "outputs must be an array of strings");
  if (!Array.isArray(evidence.commands)) fail("RepairEvidence", "commands must be an array");
  const commands = evidence.commands.map((command, index) => validateRedactedCommandEvidence(command, index));
  if (!Object.values(EVIDENCE_RESULT).includes(evidence.result)) {
    fail("RepairEvidence", `result must be one of ${Object.values(EVIDENCE_RESULT).join(", ")}`);
  }
  if (!isStringArray(evidence.reasonCodes)) fail("RepairEvidence", "reasonCodes must be an array of strings");
  if (!isNonEmptyString(evidence.evidenceHash)) fail("RepairEvidence", "evidenceHash must be a non-empty string");
  return Object.freeze({
    repairId: evidence.repairId, stage: evidence.stage, startedAt: evidence.startedAt,
    completedAt: evidence.completedAt ?? null, actorType: evidence.actorType, actorId: evidence.actorId,
    canonicalOwnerId: evidence.canonicalOwnerId ?? null, inputs: Object.freeze([...evidence.inputs]),
    outputs: Object.freeze([...evidence.outputs]), commands: Object.freeze(commands), result: evidence.result,
    reasonCodes: Object.freeze([...evidence.reasonCodes]), evidenceHash: evidence.evidenceHash,
  });
}

function validateRepairClassPolicy(repairClass, policy) {
  if (!isPlainObject(policy)) fail("RepairAuthorityPolicy", `repairClasses["${repairClass}"] must be an object`);
  if (!isAuthorityLevel(policy.maxLevel)) fail("RepairAuthorityPolicy", `repairClasses["${repairClass}"].maxLevel must be an integer 0-4`);
  if (!isStringArray(policy.requiredChecks)) fail("RepairAuthorityPolicy", `repairClasses["${repairClass}"].requiredChecks must be an array of strings`);
  if (!isStringArray(policy.allowedPaths)) fail("RepairAuthorityPolicy", `repairClasses["${repairClass}"].allowedPaths must be an array of strings`);
  if (!isStringArray(policy.forbiddenPaths)) fail("RepairAuthorityPolicy", `repairClasses["${repairClass}"].forbiddenPaths must be an array of strings`);
  if (!Number.isInteger(policy.minimumSuccessfulSupervisedRuns) || policy.minimumSuccessfulSupervisedRuns < 0) {
    fail("RepairAuthorityPolicy", `repairClasses["${repairClass}"].minimumSuccessfulSupervisedRuns must be a non-negative integer`);
  }
  if (typeof policy.requiresOwnerApproval !== "boolean") {
    fail("RepairAuthorityPolicy", `repairClasses["${repairClass}"].requiresOwnerApproval must be a boolean`);
  }
  return Object.freeze({
    maxLevel: policy.maxLevel, requiredChecks: Object.freeze([...policy.requiredChecks]),
    allowedPaths: Object.freeze([...policy.allowedPaths]), forbiddenPaths: Object.freeze([...policy.forbiddenPaths]),
    minimumSuccessfulSupervisedRuns: policy.minimumSuccessfulSupervisedRuns, requiresOwnerApproval: policy.requiresOwnerApproval,
  });
}

export function validateRepairAuthorityPolicy(policy) {
  if (!isPlainObject(policy)) fail("RepairAuthorityPolicy", "must be an object");
  if (!isNonEmptyString(policy.policyVersion)) fail("RepairAuthorityPolicy", "policyVersion must be a non-empty string");
  // The design doc fixes defaultLevel at 1 (Diagnose) for the entire initial implementation (Section 3:
  // "Do not enable Levels 3 or 4 during the initial implementation") -- a policy claiming any other
  // default is rejected outright, which is what makes "policy cannot promote itself" true structurally
  // rather than by convention.
  if (policy.defaultLevel !== 1) fail("RepairAuthorityPolicy", "defaultLevel must be exactly 1 (Diagnose) in this version");
  if (!isPlainObject(policy.repairClasses)) fail("RepairAuthorityPolicy", "repairClasses must be an object");
  const repairClasses = {};
  for (const [repairClass, classPolicy] of Object.entries(policy.repairClasses)) {
    repairClasses[repairClass] = validateRepairClassPolicy(repairClass, classPolicy);
  }
  if (!isStringArray(policy.protectedOperations)) fail("RepairAuthorityPolicy", "protectedOperations must be an array of strings");
  if (!isPlainObject(policy.circuitBreaker)) fail("RepairAuthorityPolicy", "circuitBreaker must be an object");
  const { circuitBreaker } = policy;
  if (!Number.isInteger(circuitBreaker.maximumAttemptsPerIncident) || circuitBreaker.maximumAttemptsPerIncident < 1) {
    fail("RepairAuthorityPolicy", "circuitBreaker.maximumAttemptsPerIncident must be a positive integer");
  }
  if (!Number.isInteger(circuitBreaker.maximumOpenRepairs) || circuitBreaker.maximumOpenRepairs < 1) {
    fail("RepairAuthorityPolicy", "circuitBreaker.maximumOpenRepairs must be a positive integer");
  }
  if (typeof circuitBreaker.stopOnInfrastructureUncertainty !== "boolean") {
    fail("RepairAuthorityPolicy", "circuitBreaker.stopOnInfrastructureUncertainty must be a boolean");
  }
  return Object.freeze({
    policyVersion: policy.policyVersion, defaultLevel: 1, repairClasses: Object.freeze(repairClasses),
    protectedOperations: Object.freeze([...policy.protectedOperations]),
    circuitBreaker: Object.freeze({
      maximumAttemptsPerIncident: circuitBreaker.maximumAttemptsPerIncident,
      maximumOpenRepairs: circuitBreaker.maximumOpenRepairs,
      stopOnInfrastructureUncertainty: circuitBreaker.stopOnInfrastructureUncertainty,
    }),
  });
}

// Not in the design doc's TS types but required by Section 10 ("Approval records must bind the approver,
// manifest hash, base SHA, maximum authority, and expiration") and by the user's explicit contract list.
export function validateRepairApproval(approval) {
  if (!isPlainObject(approval)) fail("RepairApproval", "must be an object");
  if (!isNonEmptyString(approval.approverId)) fail("RepairApproval", "approverId must be a non-empty string");
  if (!isNonEmptyString(approval.manifestHash)) fail("RepairApproval", "manifestHash must be a non-empty string");
  if (!isNonEmptyString(approval.baseSha)) fail("RepairApproval", "baseSha must be a non-empty string");
  if (!isAuthorityLevel(approval.maxAuthority)) fail("RepairApproval", "maxAuthority must be an integer 0-4");
  if (!isNonEmptyString(approval.grantedAt)) fail("RepairApproval", "grantedAt must be a non-empty string");
  if (!isNonEmptyString(approval.expiresAt)) fail("RepairApproval", "expiresAt must be a non-empty string");
  return Object.freeze({
    approverId: approval.approverId, manifestHash: approval.manifestHash, baseSha: approval.baseSha,
    maxAuthority: approval.maxAuthority, grantedAt: approval.grantedAt, expiresAt: approval.expiresAt,
  });
}

// Not in the design doc's TS types but required by Section 6.H ("must provide machine-readable reason
// codes") and by the user's explicit contract list -- the authority evaluator's own output shape.
export function validateRepairDecision(decision) {
  if (!isPlainObject(decision)) fail("RepairDecision", "must be an object");
  if (!isNonEmptyString(decision.repairId)) fail("RepairDecision", "repairId must be a non-empty string");
  if (!isNonEmptyString(decision.policyVersion)) fail("RepairDecision", "policyVersion must be a non-empty string");
  if (!Object.values(AUTHORITY_DECISION).includes(decision.decision)) {
    fail("RepairDecision", `decision must be one of ${Object.values(AUTHORITY_DECISION).join(", ")}`);
  }
  if (!isStringArray(decision.reasonCodes) || decision.reasonCodes.length === 0) {
    fail("RepairDecision", "reasonCodes must be a non-empty array of strings");
  }
  if (!isNonEmptyString(decision.evaluatedAt)) fail("RepairDecision", "evaluatedAt must be a non-empty string");
  return Object.freeze({
    repairId: decision.repairId, policyVersion: decision.policyVersion, decision: decision.decision,
    reasonCodes: Object.freeze([...decision.reasonCodes]), evaluatedAt: decision.evaluatedAt,
  });
}
