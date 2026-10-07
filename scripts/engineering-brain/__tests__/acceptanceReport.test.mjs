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

  it("reports NOT CLEAN when coverage has an issue, and lists the manifest problem", () => {
    const inputs = cleanInputs();
    inputs.freshManifest = freshManifest({ coverage_issues: [{ path: "x.md", issue: "registered_path_missing" }] });
    inputs.manifestValidation = { ok: false, problems: ["Coverage issue: x.md -- registered_path_missing"] };
    const report = renderAcceptanceReport(buildAcceptanceModel(inputs));
    expect(report).toContain("> Acceptance: NOT CLEAN.");
    expect(report).toContain("Coverage issue: x.md -- registered_path_missing");
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
