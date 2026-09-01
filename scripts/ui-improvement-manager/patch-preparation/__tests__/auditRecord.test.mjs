import { describe, expect, it } from "vitest";
import { MalformedAuditRecordError, buildAuditRecord, validateAuditRecord } from "../auditRecord.mjs";
import { computeProposalDigest } from "../proposalContracts.mjs";

function proposal(overrides = {}) {
  const base = {
    proposalId: "proposal_1", findingIds: ["finding_1"], objective: "x",
    allowedPaths: ["src/components/home/HomePetOfWeek.js"], forbiddenPaths: [],
    fileEdits: [{ path: "src/components/home/HomePetOfWeek.js", content: "x" }],
  };
  const merged = { ...base, ...overrides };
  return { ...merged, digest: computeProposalDigest(merged) };
}

function approval(p) {
  return { approverId: "jasonmorgan99@gmail.com", proposalId: p.proposalId, proposalDigest: p.digest, grantedAt: "2026-09-01T11:00:00.000Z", expiresAt: "2026-09-01T13:00:00.000Z" };
}

function patchResult() {
  return {
    branchName: "ui-improvement-manager/patch-proposal_1-abc123",
    baseSha: "e319c5e70abcdef0123456789abcdef01234567",
    files: [{ path: "src/components/home/HomePetOfWeek.js", beforeHash: "sha256:before", afterHash: "sha256:after", isNewFile: false }],
    diffHash: "sha256:diffhash",
    commands: [{ command: "git worktree add ...", exitCode: 0, redacted: true }],
  };
}

function validationResult() {
  return { passed: true, results: [{ step: "focused_tests", passed: true, redacted: true, summary: "ok" }] };
}

describe("buildAuditRecord / validateAuditRecord", () => {
  // Required test: audit completeness
  it("a built record contains proposal, approval, acting user, branch, files, hashes, commands, results, and rollback instructions -- every required field, none missing", () => {
    const p = proposal();
    const record = buildAuditRecord({
      auditId: "audit_1", proposal: p, approval: approval(p), actingUserId: "jasonmorgan99@gmail.com",
      patchResult: patchResult(), validationResult: validationResult(),
    });
    expect(record.proposalId).toBe(p.proposalId);
    expect(record.proposalDigest).toBe(p.digest);
    expect(record.approverId).toBe("jasonmorgan99@gmail.com");
    expect(record.actingUserId).toBe("jasonmorgan99@gmail.com");
    expect(record.branchName).toBe(patchResult().branchName);
    expect(record.baseSha).toBe(patchResult().baseSha);
    expect(record.files).toHaveLength(1);
    expect(record.files[0].afterHash).toBe("sha256:after");
    expect(record.diffHash).toBe("sha256:diffhash");
    expect(record.commands).toHaveLength(1);
    expect(record.validationResults).toHaveLength(1);
    expect(record.validationPassed).toBe(true);
    expect(record.recordedAt).toBeDefined();
    expect(record.rollbackInstructions.length).toBeGreaterThan(0);
  });

  it("records a failed validation outcome faithfully, not silently as passed", () => {
    const p = proposal();
    const record = buildAuditRecord({
      auditId: "audit_1", proposal: p, approval: approval(p), actingUserId: "jasonmorgan99@gmail.com",
      patchResult: patchResult(), validationResult: { passed: false, results: [{ step: "focused_tests", passed: false, redacted: true, summary: "failed" }] },
    });
    expect(record.validationPassed).toBe(false);
  });

  it("rollback instructions never claim anything was committed or pushed", () => {
    const p = proposal();
    const record = buildAuditRecord({
      auditId: "audit_1", proposal: p, approval: approval(p), actingUserId: "jasonmorgan99@gmail.com",
      patchResult: patchResult(), validationResult: validationResult(),
    });
    expect(record.rollbackInstructions.toLowerCase()).not.toMatch(/\bpushed to\b|\bcommitted to main\b/);
  });

  it("rejects a record missing a required field", () => {
    expect(() => validateAuditRecord({ auditId: "a" })).toThrow(MalformedAuditRecordError);
  });

  it("rejects a command entry that isn't marked redacted", () => {
    const p = proposal();
    expect(() => buildAuditRecord({
      auditId: "audit_1", proposal: p, approval: approval(p), actingUserId: "x",
      patchResult: { ...patchResult(), commands: [{ command: "git diff", exitCode: 0, redacted: false }] },
      validationResult: validationResult(),
    })).toThrow(/redacted/);
  });

  it("rejects an empty files array -- an audit record with no files touched is malformed, not a valid empty patch", () => {
    const p = proposal();
    expect(() => buildAuditRecord({
      auditId: "audit_1", proposal: p, approval: approval(p), actingUserId: "x",
      patchResult: { ...patchResult(), files: [] }, validationResult: validationResult(),
    })).toThrow(/files/);
  });

  it("returns a frozen object", () => {
    const p = proposal();
    const record = buildAuditRecord({
      auditId: "audit_1", proposal: p, approval: approval(p), actingUserId: "x",
      patchResult: patchResult(), validationResult: validationResult(),
    });
    expect(() => { record.validationPassed = false; }).toThrow();
  });
});
