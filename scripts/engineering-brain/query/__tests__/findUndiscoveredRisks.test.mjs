import { describe, expect, it } from "vitest";
import {
  findFixHotspots,
  findUntestedSources,
  findLatentConflicts,
  findUndiscoveredRisks,
} from "../findUndiscoveredRisks.mjs";

function bugRecord(overrides) {
  return {
    sha: "abc123",
    date: "2026-09-01T00:00:00.000Z",
    subject: "fix: something broke",
    files: ["src/lib/a.js"],
    pr: 1,
    class: "fix",
    ...overrides,
  };
}

function manifestRecord(overrides) {
  return {
    source_path: "src/lib/a.js",
    source_type: "application_source_file",
    symbol_or_section: null,
    commit_sha: "abc123",
    content_hash: "hash-a",
    authority_level: "current",
    details: null,
    ...overrides,
  };
}

describe("findFixHotspots", () => {
  it("ranks files by genuine fix count, ignoring test and doc fixes", () => {
    const records = [
      bugRecord({ files: ["src/lib/a.js"], date: "2026-09-01T00:00:00.000Z", subject: "fix: first" }),
      bugRecord({ files: ["src/lib/a.js", "src/lib/b.js"], date: "2026-09-02T00:00:00.000Z", subject: "fix: second" }),
      bugRecord({ files: ["src/lib/b.js"], date: "2026-09-03T00:00:00.000Z", subject: "fix: third" }),
      bugRecord({ files: ["src/lib/a.js"], date: "2026-09-04T00:00:00.000Z", subject: "fix: fourth" }),
      bugRecord({ files: ["src/lib/c.js"], date: "2026-09-05T00:00:00.000Z", subject: "test: fix flaky test", class: "test-fix" }),
      bugRecord({ files: ["docs/x.md"], date: "2026-09-06T00:00:00.000Z", subject: "docs: fix typo", class: "docs-fix" }),
      bugRecord({ files: ["src/lib/a.js"], date: "2026-09-07T00:00:00.000Z", subject: "Revert \"feat: bad change\"", class: "revert" }),
    ];
    const hotspots = findFixHotspots(records);
    expect(hotspots.map((h) => h.path)).toEqual(["src/lib/a.js", "src/lib/b.js"]);
    expect(hotspots[0].fixCount).toBe(4); // 3 fixes + 1 revert
    expect(hotspots[0].firstFix).toBe("2026-09-01T00:00:00.000Z");
    expect(hotspots[0].latestFix).toBe("2026-09-07T00:00:00.000Z");
    expect(hotspots[0].recentSubjects).toHaveLength(3);
    expect(hotspots[0].recentSubjects[0]).toBe("Revert \"feat: bad change\"");
  });

  it("breaks ties by most recent fix and honors topN", () => {
    const records = [
      bugRecord({ files: ["src/old.js"], date: "2026-08-01T00:00:00.000Z" }),
      bugRecord({ files: ["src/new.js"], date: "2026-09-10T00:00:00.000Z" }),
    ];
    const hotspots = findFixHotspots(records, { topN: 1 });
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0].path).toBe("src/new.js");
  });

  it("returns an empty list when there are no genuine fixes", () => {
    expect(findFixHotspots([bugRecord({ class: "test-fix" })])).toEqual([]);
    expect(findFixHotspots([])).toEqual([]);
    expect(findFixHotspots(null)).toEqual([]);
  });
});

describe("findUntestedSources", () => {
  it("flags source files with no paired test and counts their symbols", () => {
    const records = [
      manifestRecord({ source_path: "src/lib/tested.js", source_type: "application_source_file" }),
      manifestRecord({ source_path: "src/lib/tested.js", source_type: "application_source_symbol", symbol_or_section: "doThing" }),
      manifestRecord({
        source_path: "src/lib/tested.test.js",
        source_type: "test_file",
        details: { associatedSourcePaths: ["src/lib/tested.js"] },
      }),
      manifestRecord({ source_path: "src/lib/lonely.js", source_type: "application_source_file" }),
      manifestRecord({ source_path: "src/lib/lonely.js", source_type: "application_source_symbol", symbol_or_section: "a" }),
      manifestRecord({ source_path: "src/lib/lonely.js", source_type: "application_source_symbol", symbol_or_section: "b" }),
      manifestRecord({ source_path: "src/app/api/things/route.js", source_type: "api_route_file", details: { routePath: "/api/things" } }),
    ];
    const untested = findUntestedSources(records);
    expect(untested.map((u) => u.path)).toEqual(["src/lib/lonely.js", "src/app/api/things/route.js"]);
    expect(untested[0]).toMatchObject({ sourceType: "application_source_file", symbolCount: 2 });
    expect(untested[1]).toMatchObject({ sourceType: "api_route_file", symbolCount: 0 });
  });

  it("treats records with missing details as untested rather than crashing", () => {
    const records = [
      manifestRecord({ source_path: "src/lib/x.js", source_type: "application_source_file" }),
      manifestRecord({ source_path: "src/lib/y.test.js", source_type: "test_file", details: null }),
    ];
    expect(findUntestedSources(records).map((u) => u.path)).toEqual(["src/lib/x.js"]);
  });

  it("returns an empty list when every source has a paired test", () => {
    const records = [
      manifestRecord({ source_path: "src/lib/a.js", source_type: "application_source_file" }),
      manifestRecord({
        source_path: "src/lib/a.test.js",
        source_type: "test_file",
        details: { associatedSourcePaths: ["src/lib/a.js"] },
      }),
    ];
    expect(findUntestedSources(records)).toEqual([]);
  });
});

describe("findLatentConflicts", () => {
  it("surfaces a doc-vs-code disagreement from the full record set", () => {
    const records = [
      manifestRecord({
        source_path: "docs/decisions.md",
        source_type: "reviewed_decision",
        symbol_or_section: "retry_policy",
        content_hash: "old",
        authority_level: "reviewed_decision",
      }),
      manifestRecord({
        source_path: "src/lib/retry.js",
        source_type: "application_source_symbol",
        symbol_or_section: "retry_policy",
        content_hash: "new",
        authority_level: "current",
      }),
      manifestRecord({
        source_path: "src/lib/other.js",
        source_type: "application_source_symbol",
        symbol_or_section: "unrelated",
        content_hash: "same",
        authority_level: "current",
      }),
    ];
    const conflicts = findLatentConflicts(records);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].subject).toBe("retry_policy");
    expect(conflicts[0].winner.authority_level).toBe("current");
  });

  it("reports nothing when tiers agree", () => {
    expect(findLatentConflicts([
      manifestRecord({ symbol_or_section: "x", content_hash: "same", authority_level: "current" }),
      manifestRecord({ source_path: "docs/y.md", source_type: "reviewed_decision", symbol_or_section: "x", content_hash: "same", authority_level: "reviewed_decision" }),
    ])).toEqual([]);
  });
});

describe("findUndiscoveredRisks", () => {
  it("assembles the full report with counts", () => {
    const report = findUndiscoveredRisks({
      manifestRecords: [
        manifestRecord({ source_path: "src/lib/a.js", source_type: "application_source_file" }),
      ],
      bugRecords: [bugRecord({ files: ["src/lib/a.js"] })],
      topHotspots: 5,
    });
    expect(report.counts).toMatchObject({
      hotspotFiles: 1,
      untestedSources: 1,
      latentConflicts: 0,
      manifestRecords: 1,
      bugRecords: 1,
    });
    expect(report.hotspots[0].path).toBe("src/lib/a.js");
    expect(report.untestedSources[0].path).toBe("src/lib/a.js");
  });
});
