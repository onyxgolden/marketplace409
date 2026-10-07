import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSIFICATIONS,
  EXPECTED_FAMILIES,
  discoverGovernedDocuments,
  findMissingRegisteredPaths,
  findUnregisteredGoverned,
  getRegistry,
  renderRegistry,
  sortRegistry,
  validateRegistry,
} from "../canonicalDocumentRegistry.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function entry(overrides = {}) {
  return {
    path: "docs/product/EXAMPLE.md",
    families: ["product_roadmap"],
    classification: CLASSIFICATIONS.CANONICAL,
    brain_authority: "synchronized_document",
    status: "Foundational Draft",
    evidence: "test evidence",
    rationale: "test rationale",
    ...overrides,
  };
}

// A minimal valid registry: one canonical entry per expected family.
function fullValidRegistry() {
  const entries = [];
  for (const [family, classification] of Object.entries(EXPECTED_FAMILIES)) {
    const historical = classification === CLASSIFICATIONS.HISTORICAL;
    entries.push(entry({
      path: `docs/test/${family}.md`,
      families: [family],
      classification,
      brain_authority: historical ? "historical_snapshot" : "synchronized_document",
    }));
  }
  return entries;
}

describe("canonical document registry: contract validation", () => {
  it("accepts a complete valid registry", () => {
    expect(validateRegistry(fullValidRegistry())).toEqual([]);
  });

  it("rejects duplicate paths", () => {
    const entries = [entry(), entry({ families: ["product_decisions"] })];
    const issues = validateRegistry(entries);
    expect(issues.some((i) => i.includes("duplicate path"))).toBe(true);
  });

  it("rejects an invalid classification", () => {
    const issues = validateRegistry([entry({ classification: "authoritative-ish" })]);
    expect(issues.some((i) => i.includes("invalid classification"))).toBe(true);
  });

  it("rejects an unknown Brain authority tier", () => {
    const issues = validateRegistry([entry({ brain_authority: "super_canonical" })]);
    expect(issues.some((i) => i.includes("invalid brain_authority"))).toBe(true);
  });

  it("never lets a canonical document sit in the historical tier", () => {
    const issues = validateRegistry([entry({ brain_authority: "historical_snapshot" })]);
    expect(issues.some((i) => i.includes("must not use the historical_snapshot tier"))).toBe(true);
  });

  it("requires historical documents to use the historical tier", () => {
    const issues = validateRegistry([entry({
      classification: CLASSIFICATIONS.HISTORICAL,
      brain_authority: "current",
    })]);
    expect(issues.some((i) => i.includes("must use the historical_snapshot tier"))).toBe(true);
  });

  it("requires excluded entries to carry no authority and a reason", () => {
    const withAuthority = validateRegistry([entry({
      classification: CLASSIFICATIONS.EXCLUDED,
      brain_authority: "current",
      families: [],
      reason: "x",
    })]);
    expect(withAuthority.some((i) => i.includes("brain_authority null"))).toBe(true);

    const noReason = validateRegistry([entry({
      classification: CLASSIFICATIONS.EXCLUDED,
      brain_authority: null,
      families: [],
    })]);
    expect(noReason.some((i) => i.includes("need a reason"))).toBe(true);
  });

  it("requires every non-excluded entry to name a family and carry evidence", () => {
    const issues = validateRegistry([entry({ families: [], evidence: "" })]);
    expect(issues.some((i) => i.includes("must name at least one family"))).toBe(true);
    expect(issues.some((i) => i.includes("evidence is required"))).toBe(true);
  });

  it("rejects non-normalized paths", () => {
    const issues = validateRegistry([entry({ path: "../escape.md" })]);
    expect(issues.some((i) => i.includes("normalized repository-relative path"))).toBe(true);
  });

  it("reports a family that no entry of its expected classification represents", () => {
    const entries = fullValidRegistry().filter((e) => !e.families.includes("customer_journeys"));
    const issues = validateRegistry(entries);
    expect(issues).toContain("family customer_journeys: no canonical entry represents it");
  });
});

describe("canonical document registry: tracked-path checks", () => {
  it("detects a registered path that is missing from the tracked set", () => {
    const entries = fullValidRegistry();
    const tracked = new Set(entries.map((e) => e.path));
    tracked.delete("docs/test/customer_journeys.md");
    expect(findMissingRegisteredPaths(entries, tracked)).toEqual(["docs/test/customer_journeys.md"]);
    const issues = validateRegistry(entries, { trackedPaths: tracked });
    expect(issues).toContain("docs/test/customer_journeys.md: registered path is not tracked in the repository");
  });

  it("reports nothing missing when every registered path is tracked", () => {
    const entries = fullValidRegistry();
    const tracked = new Set(entries.map((e) => e.path));
    expect(findMissingRegisteredPaths(entries, tracked)).toEqual([]);
  });

  it("every registered path exists in this checkout", () => {
    const missing = getRegistry().filter((e) => !existsSync(join(REPO_ROOT, e.path))).map((e) => e.path);
    expect(missing).toEqual([]);
  });
});

describe("canonical document registry: real contents", () => {
  it("validates the shipped registry with no issues", () => {
    expect(validateRegistry(getRegistry())).toEqual([]);
  });

  it("represents every expected canonical family and the bootstrap families", () => {
    const registry = getRegistry();
    for (const [family, classification] of Object.entries(EXPECTED_FAMILIES)) {
      const hit = registry.some((e) => e.families.includes(family) && e.classification === classification);
      expect(hit, `${family} as ${classification}`).toBe(true);
    }
  });

  it("never registers executive or documentation bootstrap material as canonical", () => {
    const registry = getRegistry();
    const bootstrap = registry.filter((e) =>
      e.families.includes("executive_bootstrap") || e.families.includes("documentation_bootstrap"));
    expect(bootstrap.length).toBeGreaterThan(0);
    for (const e of bootstrap) {
      expect(e.classification).toBe(CLASSIFICATIONS.HISTORICAL);
      expect(e.brain_authority).toBe("historical_snapshot");
    }
  });

  // Slice 1 checks the classification only. Ranking order is tested with the indexing slice.
  it("classifies the Executive Bootstrap as historical (ranking is tested in the indexing slice)", () => {
    const executive = getRegistry().find((e) => e.path === "docs/architecture/FORGE_EXECUTIVE_BOOTSTRAP.md");
    expect(executive.classification).toBe(CLASSIFICATIONS.HISTORICAL);
    expect(executive.brain_authority).toBe("historical_snapshot");
  });

  it("names the owner-map references that are missing, without registering them", () => {
    const registry = getRegistry();
    expect(registry.some((e) => e.path === "docs/governance/FORGE_IDEA_REGISTER.md")).toBe(false);
    expect(registry.some((e) => e.path === "docs/governance/FORGE_KNOWLEDGE_ARCHITECTURE.md")).toBe(false);
  });
});

describe("canonical document registry: completeness of the governed scope", () => {
  // The regression that stops a new governed document from silently falling outside the registry.
  // The scope is enumerated from disk, so a new FORGE_*.md under a declared directory fails this test
  // until it gets an explicit canonical, historical, or excluded entry.
  it("every document in the declared governed scope has a registry entry", () => {
    const discovered = discoverGovernedDocuments(REPO_ROOT);
    expect(discovered.length).toBeGreaterThan(0);
    expect(findUnregisteredGoverned(getRegistry(), discovered)).toEqual([]);
  });

  it("the detector catches a governed document that has no entry", () => {
    const entries = getRegistry().filter((e) => e.path !== "docs/forge-os/architecture/WORKSPACE_MODEL.md");
    const discovered = discoverGovernedDocuments(REPO_ROOT);
    expect(findUnregisteredGoverned(entries, discovered)).toEqual(["docs/forge-os/architecture/WORKSPACE_MODEL.md"]);
  });

  it("the detector catches a brand-new governed document in a synthetic scope", () => {
    expect(findUnregisteredGoverned(getRegistry(), ["docs/product/FORGE_NEW_SIBLING.md"]))
      .toEqual(["docs/product/FORGE_NEW_SIBLING.md"]);
  });

  it("names the documents the review said were invisible, and they now have explicit entries", () => {
    const registry = getRegistry();
    const byPath = new Map(registry.map((e) => [e.path, e]));
    const named = [
      "docs/forge-os/architecture/WORKSPACE_MODEL.md",
      "docs/forge-os/architecture/FORGE_DOCUMENT_LIFECYCLE.md",
      "docs/architecture/FORGE_ENGINEERING_CONTROL_CENTER.md",
      "docs/architecture/ARCHITECTURE_DECISIONS.md",
      "docs/architecture/FORGE_GUARD_SYSTEM.md",
      "docs/product/FORGE_PRODUCT_RESEARCH_STANDARD.md",
    ];
    for (const path of named) {
      expect(byPath.has(path), path).toBe(true);
    }
    expect(byPath.get("docs/forge-os/architecture/FORGE_DOCUMENT_LIFECYCLE.md").classification)
      .toBe(CLASSIFICATIONS.CANONICAL);
    expect(byPath.get("docs/forge-os/architecture/WORKSPACE_MODEL.md").classification)
      .toBe(CLASSIFICATIONS.EXCLUDED);
  });

  it("every excluded entry states why, so exclusions are reviewable", () => {
    for (const e of getRegistry().filter((x) => x.classification === CLASSIFICATIONS.EXCLUDED)) {
      expect(typeof e.reason, e.path).toBe("string");
      expect(e.reason.length, e.path).toBeGreaterThan(0);
    }
  });

  it("the declared scope patterns cover the directories the index names", () => {
    expect(discoverGovernedDocuments(REPO_ROOT).some((p) => p.startsWith("docs/ai-engineering-organization/"))).toBe(true);
    expect(discoverGovernedDocuments(REPO_ROOT).some((p) => p.startsWith("docs/forge-os/architecture/"))).toBe(true);
    expect(discoverGovernedDocuments(REPO_ROOT).some((p) => p.startsWith("docs/product/"))).toBe(true);
  });
});

describe("canonical document registry: deterministic output", () => {
  it("sorts by path regardless of input order", () => {
    const shuffled = [...getRegistry()].reverse();
    expect(sortRegistry(shuffled).map((e) => e.path)).toEqual(getRegistry().map((e) => e.path));
  });

  it("renders identical text for identical input", () => {
    expect(renderRegistry(getRegistry())).toBe(renderRegistry(getRegistry()));
  });

  it("renders the same text whatever order the entries arrive in", () => {
    const registry = getRegistry();
    expect(renderRegistry([...registry].reverse())).toBe(renderRegistry(registry));
  });
});
