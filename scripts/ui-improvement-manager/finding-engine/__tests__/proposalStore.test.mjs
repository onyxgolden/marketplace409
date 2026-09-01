import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROPOSAL_ACTIONS, ProposalStoreError, applyProposalAction, readProposals } from "../proposalStore.mjs";

function finding(overrides = {}) {
  return {
    findingId: "finding_abc123", ruleId: "horizontal-overflow", category: "horizontal_overflow", findingClass: "deterministic",
    application: "409 Marketplace FORGE", routeId: "home", routePath: "/", viewport: "mobile",
    screenshotHash: `sha256:${"a".repeat(64)}`, probableSourceFiles: ["src/app/page.js"], affectedComponent: null,
    severity: "medium", confidence: "high", explanation: "x", proposedImprovement: "y",
    validationRequirements: ["z"], prohibitedScope: ["w"], rollbackDescription: "revert",
    status: "new", detectedAt: "2026-09-01T00:00:00.000Z", ...overrides,
  };
}

let evidenceDir;
beforeEach(() => {
  evidenceDir = mkdtempSync(path.join(tmpdir(), "fb-ui-2-proposals-"));
});
afterEach(() => { rmSync(evidenceDir, { recursive: true, force: true }); });

function writeManifest(findings) {
  writeFileSync(path.join(evidenceDir, "findings-manifest.json"), JSON.stringify({ schemaVersion: "1.0", findings }));
}

describe("readProposals", () => {
  it("fails closed when no findings manifest exists yet", () => {
    expect(() => readProposals(evidenceDir)).toThrow(ProposalStoreError);
  });

  it("reads a written manifest back", () => {
    writeManifest([finding()]);
    const manifest = readProposals(evidenceDir);
    expect(manifest.findings).toHaveLength(1);
  });

  it("fails closed on malformed JSON", () => {
    writeFileSync(path.join(evidenceDir, "findings-manifest.json"), "{not json");
    expect(() => readProposals(evidenceDir)).toThrow(/not valid JSON/);
  });
});

describe("applyProposalAction", () => {
  it("supports exactly the four required review actions", () => {
    expect([...PROPOSAL_ACTIONS].sort()).toEqual(["approve_preview", "reject", "request_revision", "review"].sort());
  });

  it("marks a finding reviewed", () => {
    writeManifest([finding()]);
    const updated = applyProposalAction(evidenceDir, "finding_abc123", "review");
    expect(updated.status).toBe("reviewed");
  });

  it("marks a finding rejected", () => {
    writeManifest([finding()]);
    expect(applyProposalAction(evidenceDir, "finding_abc123", "reject").status).toBe("rejected");
  });

  it("marks a finding revision_requested", () => {
    writeManifest([finding()]);
    expect(applyProposalAction(evidenceDir, "finding_abc123", "request_revision").status).toBe("revision_requested");
  });

  it("marks a finding preview_approved -- and this is the only effect: no other field changes", () => {
    writeManifest([finding()]);
    const before = readProposals(evidenceDir).findings[0];
    const updated = applyProposalAction(evidenceDir, "finding_abc123", "approve_preview");
    expect(updated.status).toBe("preview_approved");
    expect({ ...updated, status: before.status }).toEqual(before);
  });

  it("persists the status change to disk", () => {
    writeManifest([finding()]);
    applyProposalAction(evidenceDir, "finding_abc123", "reject");
    expect(readProposals(evidenceDir).findings[0].status).toBe("rejected");
  });

  it("fails closed on an unknown action", () => {
    writeManifest([finding()]);
    expect(() => applyProposalAction(evidenceDir, "finding_abc123", "delete_forever")).toThrow(/Unknown review action/);
  });

  it("fails closed on an unknown findingId", () => {
    writeManifest([finding()]);
    expect(() => applyProposalAction(evidenceDir, "finding_does_not_exist", "reject")).toThrow(/No finding with id/);
  });

  it("leaves every other finding in the manifest untouched", () => {
    writeManifest([finding(), finding({ findingId: "finding_other" })]);
    applyProposalAction(evidenceDir, "finding_abc123", "reject");
    const manifest = readProposals(evidenceDir);
    expect(manifest.findings.find((f) => f.findingId === "finding_other").status).toBe("new");
  });
});
