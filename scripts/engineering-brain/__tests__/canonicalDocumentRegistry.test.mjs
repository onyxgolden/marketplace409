import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSIFICATIONS,
  EXPECTED_FAMILIES,
  findMissingRegisteredPaths,
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

  it("keeps the Executive Bootstrap below every canonical document in authority", () => {
    const executive = getRegistry().find((e) => e.path === "docs/architecture/FORGE_EXECUTIVE_BOOTSTRAP.md");
    expect(executive.classification).toBe(CLASSIFICATIONS.HISTORICAL);
  });

  it("names the owner-map references that are missing, without registering them", () => {
    const registry = getRegistry();
    expect(registry.some((e) => e.path === "docs/governance/FORGE_IDEA_REGISTER.md")).toBe(false);
    expect(registry.some((e) => e.path === "docs/governance/FORGE_KNOWLEDGE_ARCHITECTURE.md")).toBe(false);
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
