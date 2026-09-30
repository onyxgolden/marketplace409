import { describe, expect, it } from "vitest";
import {
  rerankImplicatedCode,
  matchEvidenceTier,
  normalizeEvidencePath,
  TIER_EXACT_PATH,
  TIER_BASENAME_OR_SUFFIX,
  TIER_SYMBOL_TOKEN,
  TIER_NO_MATCH,
} from "../rerankImplicatedCode.mjs";

function facetEntry(path, symbol = "handler") {
  return { source_path: path, source_type: "code", symbol_or_section: symbol, match_reason: "x" };
}

const evidence = {
  failed_step: "Build installer (NSIS)",
  error_lines: ["error: makensis failed for installer.nsi", "bundle/nsis output missing"],
  mentioned_paths: ["forge-capture-app/app/target/release/bundle/nsis/installer.nsi"],
};

describe("normalizeEvidencePath", () => {
  it("normalizes windows separators, case, and ./ prefixes for comparison", () => {
    expect(normalizeEvidencePath("Forge-Capture-App\\APP\\x.NSI")).toBe("forge-capture-app/app/x.nsi");
    expect(normalizeEvidencePath("./src/app.js")).toBe("src/app.js");
  });
});

describe("matchEvidenceTier", () => {
  it("tier 0: exact source_path hit in mentioned_paths", () => {
    const m = matchEvidenceTier(facetEntry("forge-capture-app/app/target/release/bundle/nsis/installer.nsi"), evidence);
    expect(m.tier).toBe(TIER_EXACT_PATH);
    expect(m.matched_path).toContain("installer.nsi");
  });

  it("tier 1: basename match promotes even when the directory layout differs", () => {
    const entry = facetEntry("forge-capture-app/target/release/bundle/nsis/installer.nsi", "packageNsis");
    const ev = { ...evidence, mentioned_paths: ["forge-capture-app/app/target/release/bundle/nsis/installer.nsi"] };
    const m = matchEvidenceTier(entry, ev);
    expect(m.tier).toBe(TIER_BASENAME_OR_SUFFIX);
  });

  it("tier 1: shared trailing directory chain promotes when the filename itself differs (real Capture near-miss)", () => {
    const entry = facetEntry("forge-capture-app/target/release/bundle/nsis/forge-capture-setup.nsi", "buildNsisInstaller");
    const ev = {
      failed_step: "Build installer",
      error_lines: ["upload-artifact: no files found at forge-capture-app/app/target/release/bundle/nsis/*.exe"],
      mentioned_paths: ["forge-capture-app/app/target/release/bundle/nsis/forge-capture-setup.exe"],
    };
    const m = matchEvidenceTier(entry, ev);
    expect(m.tier).toBe(TIER_BASENAME_OR_SUFFIX);
  });

  it("tier 2: symbol token appearing in the failure text promotes above no-match", () => {
    const entry = facetEntry("src/unrelated/util.js", "makensis");
    const m = matchEvidenceTier(entry, evidence);
    expect(m.tier).toBe(TIER_SYMBOL_TOKEN);
    expect(m.matched_tokens).toContain("makensis");
  });

  it("tier 3: unrelated entry stays at no-match", () => {
    const entry = facetEntry("src/billing/ledger.js", "postLedgerEntry");
    expect(matchEvidenceTier(entry, evidence).tier).toBe(TIER_NO_MATCH);
  });

  it("never throws on empty or malformed input", () => {
    expect(matchEvidenceTier(null, evidence).tier).toBe(TIER_NO_MATCH);
    expect(matchEvidenceTier(facetEntry("a.js"), null).tier).toBe(TIER_NO_MATCH);
    expect(matchEvidenceTier(facetEntry(""), evidence).tier).toBe(TIER_NO_MATCH);
    expect(matchEvidenceTier(facetEntry("a.js"), {}).tier).toBe(TIER_NO_MATCH);
  });
});

describe("rerankImplicatedCode", () => {
  it("promotes the exact-path hit above basename, symbol-token, and no-match entries", () => {
    const unrelated = facetEntry("src/billing/ledger.js", "postLedgerEntry");
    const symbolHit = facetEntry("src/unrelated/util.js", "makensis");
    const baseHit = facetEntry("forge-capture-app/target/release/bundle/nsis/installer.nsi", "packageNsis");
    const exact = facetEntry("forge-capture-app/app/target/release/bundle/nsis/installer.nsi", "buildInstaller");
    const ranked = rerankImplicatedCode([unrelated, symbolHit, baseHit, exact], evidence);
    expect(ranked.map((e) => e.source_path)).toEqual([
      "forge-capture-app/app/target/release/bundle/nsis/installer.nsi",
      "forge-capture-app/target/release/bundle/nsis/installer.nsi",
      "src/unrelated/util.js",
      "src/billing/ledger.js",
    ]);
    expect(ranked[0].evidence_match.tier).toBe(TIER_EXACT_PATH);
    expect(ranked[1].evidence_match.tier).toBe(TIER_BASENAME_OR_SUFFIX);
    expect(ranked[2].evidence_match.tier).toBe(TIER_SYMBOL_TOKEN);
    expect(ranked[3].evidence_match.tier).toBe(TIER_NO_MATCH);
  });

  it("keeps the original relative order within a tier (stable)", () => {
    const a = facetEntry("src/b.js", "zzz");
    const b = facetEntry("src/a.js", "yyy");
    const ranked = rerankImplicatedCode([a, b], evidence);
    expect(ranked.map((e) => e.source_path)).toEqual(["src/b.js", "src/a.js"]);
  });

  it("returns the original order unchanged when there is no evidence", () => {
    const entries = [facetEntry("src/b.js"), facetEntry("src/a.js")];
    expect(rerankImplicatedCode(entries, null).map((e) => e.source_path)).toEqual(["src/b.js", "src/a.js"]);
    expect(rerankImplicatedCode(entries, {}).map((e) => e.source_path)).toEqual(["src/b.js", "src/a.js"]);
    expect(rerankImplicatedCode(entries, { mentioned_paths: [], error_lines: [] }).map((e) => e.source_path))
      .toEqual(["src/b.js", "src/a.js"]);
  });

  it("still promotes on symbol tokens when mentioned_paths is empty", () => {
    const ev = { failed_step: "", error_lines: ["makensis blew up"], mentioned_paths: [] };
    const ranked = rerankImplicatedCode(
      [facetEntry("src/billing/ledger.js", "postLedgerEntry"), facetEntry("src/util.js", "makensis")],
      ev,
    );
    expect(ranked[0].source_path).toBe("src/util.js");
  });

  it("never drops or invents entries", () => {
    const entries = [facetEntry("src/b.js"), facetEntry("src/a.js"), facetEntry("src/c.js")];
    const ranked = rerankImplicatedCode(entries, evidence);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((e) => e.source_path).sort()).toEqual(["src/a.js", "src/b.js", "src/c.js"]);
  });

  it("annotates every entry with evidence_match for auditability", () => {
    const ranked = rerankImplicatedCode([facetEntry("src/a.js")], evidence);
    expect(ranked[0].evidence_match).toMatchObject({ tier: expect.any(Number) });
    expect(ranked[0].evidence_match).toHaveProperty("matched_path");
    expect(ranked[0].evidence_match).toHaveProperty("matched_tokens");
  });
});
