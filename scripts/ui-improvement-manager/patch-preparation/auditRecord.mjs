// FB-UI-3/4 rule 11: "Preserve a complete audit record of proposal, approval, acting user, branch,
// files, hashes, commands, results, and rollback instructions." One fail-closed contract, one builder
// that assembles it from the outputs every other module in this directory already produces -- nothing
// here re-derives evidence, it only requires that every required field was actually supplied.

export const AUDIT_RECORD_SCHEMA_VERSION = "1.0";

export class MalformedAuditRecordError extends Error {
  constructor(reason) {
    super(`Malformed patch preparation audit record: ${reason}`);
    this.name = "MalformedAuditRecordError";
    this.reason = reason;
  }
}

function fail(reason) {
  throw new MalformedAuditRecordError(reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateAuditRecord(record) {
  if (typeof record !== "object" || record === null) fail("record must be an object");
  for (const field of ["auditId", "proposalId", "proposalDigest", "approverId", "actingUserId", "branchName", "baseSha", "diffHash", "recordedAt", "rollbackInstructions"]) {
    if (!isNonEmptyString(record[field])) fail(`${field} must be a non-empty string`);
  }
  if (!Array.isArray(record.files) || record.files.length === 0) fail("files must be a non-empty array");
  for (const [index, file] of record.files.entries()) {
    if (!isNonEmptyString(file.path)) fail(`files[${index}].path must be a non-empty string`);
    if (!isNonEmptyString(file.afterHash)) fail(`files[${index}].afterHash must be a non-empty string`);
  }
  if (!Array.isArray(record.commands)) fail("commands must be an array");
  for (const [index, command] of record.commands.entries()) {
    if (!isNonEmptyString(command.command)) fail(`commands[${index}].command must be a non-empty string`);
    if (command.redacted !== true) fail(`commands[${index}].redacted must be true`);
  }
  if (!Array.isArray(record.validationResults) || record.validationResults.length === 0) fail("validationResults must be a non-empty array");
  if (typeof record.validationPassed !== "boolean") fail("validationPassed must be a boolean");

  return Object.freeze({
    auditId: record.auditId, proposalId: record.proposalId, proposalDigest: record.proposalDigest,
    approverId: record.approverId, actingUserId: record.actingUserId, branchName: record.branchName, baseSha: record.baseSha,
    files: Object.freeze(record.files.map((f) => Object.freeze({ ...f }))),
    diffHash: record.diffHash, commands: Object.freeze(record.commands.map((c) => Object.freeze({ ...c }))),
    validationResults: Object.freeze(record.validationResults.map((v) => Object.freeze({ ...v }))),
    validationPassed: record.validationPassed, recordedAt: record.recordedAt, rollbackInstructions: record.rollbackInstructions,
  });
}

// Assembles a validated audit record from a preparePatch.mjs result and a validatePatch.mjs result --
// the only two inputs that already carry every field rule 11 requires.
export function buildAuditRecord({ auditId, proposal, approval, actingUserId, patchResult, validationResult, now = new Date().toISOString() }) {
  return validateAuditRecord({
    auditId, proposalId: proposal.proposalId, proposalDigest: proposal.digest, approverId: approval.approverId,
    actingUserId, branchName: patchResult.branchName, baseSha: patchResult.baseSha,
    files: patchResult.files.map((f) => ({ path: f.path, beforeHash: f.beforeHash, afterHash: f.afterHash, isNewFile: f.isNewFile })),
    diffHash: patchResult.diffHash, commands: patchResult.commands,
    validationResults: validationResult.results, validationPassed: validationResult.passed, recordedAt: now,
    rollbackInstructions: `A patch prepared by this system is never committed or pushed (rule 7), so no repository rollback is ever required for it directly. To discard it: remove the isolated worktree ("git worktree remove <path> --force" from the original repository root) and delete its branch ("git branch -D ${patchResult.branchName}") if it still exists locally. Nothing in this record implies any change was ever applied to the owner's active working tree, ${proposal.allowedPaths.length > 0 ? `main branch, or any branch other than ${patchResult.branchName}` : "or any shared branch"}.`,
  });
}
