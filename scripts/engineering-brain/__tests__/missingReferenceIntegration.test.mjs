// Slice 4 review fix: a present-but-unregistered MISSING_REFERENCES path must make BOTH acceptance
// and the doc-drift integration see a real, non-proposable issue -- not silently pass, which is the
// exact fail-open condition Slice 3 closed (declared_reference_present_but_unregistered) and that an
// empty missingReferenceStatus map at this integration boundary would reopen.

import { describe, expect, it } from "vitest";
import { getRegistry, MISSING_REFERENCES } from "../canonicalDocumentRegistry.mjs";
import { buildCoverageModel } from "../canonicalCoverageReport.mjs";
import { missingReferenceStatusFromTrackedPaths } from "../missingReferencePresence.mjs";
import { canonicalCoverageDriftFindings } from "../docs/canonicalCoverageDriftFindings.mjs";
import { buildAcceptanceModel } from "../acceptanceReport.mjs";
import { runSecuritySelfCheck } from "../securitySelfCheck.mjs";

const registry = getRegistry();
const [declaredReference] = MISSING_REFERENCES;

const freshManifest = () => ({
  commit_sha: "sha-under-test",
  records: [],
  excluded: [],
  coverage_issues: [],
  counts: { indexed_total: 0, excluded_total: 0 },
});

const cleanAcceptanceInputs = (coverageIssueRows) => ({
  registry,
  freshManifest: freshManifest(),
  coverageIssueRows,
  manifestValidation: { ok: true, problems: [] },
  incrementalEquivalence: { equivalent: true, detail: "ok" },
  security: runSecuritySelfCheck(),
  docDrift: { findingCount: canonicalCoverageDriftFindings({ issueRows: coverageIssueRows }).length },
});

describe("a present-but-unregistered declared reference, carried through to acceptance and doc-drift", () => {
  it("makes the coverage model report it, with the conspicuous issue name", () => {
    const missingReferenceStatus = missingReferenceStatusFromTrackedPaths([declaredReference]);
    const model = buildCoverageModel({ registry, manifest: freshManifest(), missingReferenceStatus });
    const row = model.issueRows.find((r) => r.path === declaredReference);
    expect(row?.issue).toBe("declared_reference_present_but_unregistered");
  });

  it("makes acceptance NOT CLEAN, with a non-zero coverage issue count", () => {
    const missingReferenceStatus = missingReferenceStatusFromTrackedPaths([declaredReference]);
    const coverageModel = buildCoverageModel({ registry, manifest: freshManifest(), missingReferenceStatus });
    const acceptance = buildAcceptanceModel(cleanAcceptanceInputs(coverageModel.issueRows));
    expect(acceptance.coverageIssueCount).toBeGreaterThan(0);
  });

  it("appears as a doc-drift finding that is never auto-fixable", () => {
    const missingReferenceStatus = missingReferenceStatusFromTrackedPaths([declaredReference]);
    const coverageModel = buildCoverageModel({ registry, manifest: freshManifest(), missingReferenceStatus });
    const findings = canonicalCoverageDriftFindings(coverageModel);
    const finding = findings.find((f) => f.docPath === declaredReference);
    expect(finding?.literal).toBe("declared_reference_present_but_unregistered");
  });
});

describe("a declared reference that is genuinely absent", () => {
  it("stays informational: no coverage issue, acceptance unaffected, no doc-drift finding", () => {
    const missingReferenceStatus = missingReferenceStatusFromTrackedPaths([]); // none of MISSING_REFERENCES present
    const coverageModel = buildCoverageModel({ registry, manifest: freshManifest(), missingReferenceStatus });
    expect(coverageModel.issueRows.filter((r) => MISSING_REFERENCES.includes(r.path))).toEqual([]);
    const acceptance = buildAcceptanceModel(cleanAcceptanceInputs(coverageModel.issueRows));
    expect(acceptance.coverageIssueCount).toBe(0);
    expect(canonicalCoverageDriftFindings(coverageModel).filter((f) => MISSING_REFERENCES.includes(f.docPath))).toEqual([]);
  });
});
