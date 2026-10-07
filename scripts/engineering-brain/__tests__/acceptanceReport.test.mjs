import { describe, expect, it } from "vitest";
import { getRegistry } from "../canonicalDocumentRegistry.mjs";
import { buildAcceptanceModel, renderAcceptanceReport } from "../acceptanceReport.mjs";

const registry = getRegistry();

const freshManifest = (overrides = {}) => ({
  commit_sha: "deadbeef",
  counts: { indexed_total: 1234, excluded_total: 12 },
  coverage_issues: [],
  ...overrides,
});

const cleanInputs = () => ({
  registry,
  freshManifest: freshManifest(),
  coverageIssueRows: [],
  manifestValidation: { ok: true, problems: [] },
  incrementalEquivalence: { equivalent: true, detail: "1234 records match." },
  security: { pass: true, checks: [{ name: "a", pass: true }, { name: "b", pass: true }] },
  docDrift: { findingCount: 0 },
});

describe("buildAcceptanceModel / renderAcceptanceReport", () => {
  it("reports CLEAN when every input is clean", () => {
    const report = renderAcceptanceReport(buildAcceptanceModel(cleanInputs()));
    expect(report).toContain("> Acceptance: CLEAN.");
    expect(report).toContain("Coverage issues: **0**");
    expect(report).toContain("Result: **pass** (2 checks)");
  });

  it("reports NOT CLEAN when a coverage issue row exists, and lists it", () => {
    const inputs = cleanInputs();
    inputs.coverageIssueRows = [{ path: "x.md", classification: "canonical", issue: "registered_path_missing" }];
    const report = renderAcceptanceReport(buildAcceptanceModel(inputs));
    expect(report).toContain("> Acceptance: NOT CLEAN.");
    expect(report).toContain("Coverage issues: **1**");
  });

  it("reports NOT CLEAN when a declared-but-missing reference is present and unregistered (Slice 3 rule, carried through acceptance)", () => {
    const inputs = cleanInputs();
    inputs.coverageIssueRows = [{ path: "docs/governance/FORGE_IDEA_REGISTER.md", classification: null, issue: "declared_reference_present_but_unregistered" }];
    const report = renderAcceptanceReport(buildAcceptanceModel(inputs));
    expect(report).toContain("> Acceptance: NOT CLEAN.");
    expect(report).toContain("Coverage issues: **1**");
  });

  it("the coverage count comes from coverageIssueRows, never from freshManifest.coverage_issues alone", () => {
    const inputs = cleanInputs();
    // freshManifest.coverage_issues has an entry, but coverageIssueRows (the authoritative,
    // MISSING_REFERENCES-aware source) does not -- the model must follow coverageIssueRows.
    inputs.freshManifest = freshManifest({ coverage_issues: [{ path: "z.md", issue: "something" }] });
    inputs.coverageIssueRows = [];
    const model = buildAcceptanceModel(inputs);
    expect(model.coverageIssueCount).toBe(0);
  });

  it("reports NOT CLEAN and the manifest problems when manifest validation fails", () => {
    const inputs = cleanInputs();
    inputs.manifestValidation = { ok: false, problems: ["Committed commit_sha abc is not an ancestor of the current HEAD."] };
    const report = renderAcceptanceReport(buildAcceptanceModel(inputs));
    expect(report).toContain("> Acceptance: NOT CLEAN.");
    expect(report).toContain("Committed commit_sha abc is not an ancestor of the current HEAD.");
  });

  it("reports NOT CLEAN when incremental reuse is not equivalent", () => {
    const inputs = cleanInputs();
    inputs.incrementalEquivalence = { equivalent: false, detail: "1 record differs." };
    const report = renderAcceptanceReport(buildAcceptanceModel(inputs));
    expect(report).toContain("> Acceptance: NOT CLEAN.");
    expect(report).toContain("Result: **NOT equivalent**. 1 record differs.");
  });

  it("reports NOT CLEAN and lists the failing check when security fails", () => {
    const inputs = cleanInputs();
    inputs.security = { pass: false, checks: [{ name: "a", pass: true }, { name: "b", pass: false }] };
    const report = renderAcceptanceReport(buildAcceptanceModel(inputs));
    expect(report).toContain("> Acceptance: NOT CLEAN.");
    expect(report).toContain("Result: **FAIL** (2 checks)");
    expect(report).toContain("- [FAIL] b");
  });

  it("carries real registry counts (classification and authority) from the approved registry", () => {
    const report = renderAcceptanceReport(buildAcceptanceModel(cleanInputs()));
    expect(report).toContain(`Registered documents: **${registry.length}**.`);
    expect(report).toContain("By classification:");
    expect(report).toContain("By configured authority");
  });

  it("is deterministic and carries no timestamp", () => {
    const model = buildAcceptanceModel(cleanInputs());
    expect(renderAcceptanceReport(model)).toBe(renderAcceptanceReport(model));
    expect(renderAcceptanceReport(model)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
