import { describe, expect, it } from "vitest";
import { rankResults, compareResults } from "../rankResults.mjs";

function entry({ authority = "current", exactSymbol = false, exactPath = false, exactPhrase = false, overlap = 0, freshness = "current", path = "a.js", symbol = "a" }) {
  return {
    record: { source_path: path, symbol_or_section: symbol, authority_level: authority },
    matchSignals: { exactSymbolMatch: exactSymbol, exactPathMatch: exactPath, exactPhraseMatch: exactPhrase, tokenOverlapCount: overlap },
    freshness,
  };
}

describe("rankResults (deterministic ranking)", () => {
  it("ranks a higher-authority record first regardless of match strength", () => {
    const low = entry({ authority: "historical_snapshot", overlap: 100 });
    const high = entry({ authority: "current", overlap: 0 });
    expect(rankResults([low, high]).map((e) => e.record.authority_level)).toEqual(["current", "historical_snapshot"]);
  });

  it("within the same authority level, an exact symbol/path match outranks token overlap alone", () => {
    const exact = entry({ exactSymbol: true, overlap: 1, path: "b.js" });
    const overlapOnly = entry({ overlap: 10, path: "a.js" });
    expect(rankResults([overlapOnly, exact]).map((e) => e.record.source_path)).toEqual(["b.js", "a.js"]);
  });

  it("exact phrase match outranks token overlap when neither has an exact symbol/path match", () => {
    const phrase = entry({ exactPhrase: true, overlap: 1, path: "b.js" });
    const overlapOnly = entry({ overlap: 5, path: "a.js" });
    expect(rankResults([overlapOnly, phrase]).map((e) => e.record.source_path)).toEqual(["b.js", "a.js"]);
  });

  it("higher token overlap outranks lower, all else equal", () => {
    const more = entry({ overlap: 5, path: "b.js" });
    const fewer = entry({ overlap: 1, path: "a.js" });
    expect(rankResults([fewer, more]).map((e) => e.record.source_path)).toEqual(["b.js", "a.js"]);
  });

  it("fresher records outrank stale ones when every other signal ties", () => {
    const stale = entry({ freshness: "stale", path: "b.js" });
    const fresh = entry({ freshness: "current", path: "a.js" });
    expect(rankResults([stale, fresh]).map((e) => e.record.source_path)).toEqual(["a.js", "b.js"]);
  });

  it("falls back to a stable lexical tiebreak (source_path then symbol_or_section) when every other signal ties", () => {
    const b = entry({ path: "b.js", symbol: "x" });
    const a = entry({ path: "a.js", symbol: "x" });
    expect(rankResults([b, a]).map((e) => e.record.source_path)).toEqual(["a.js", "b.js"]);
  });

  it("compareResults is a total order that produces the same result regardless of input order (stability)", () => {
    const entries = [
      entry({ path: "c.js", overlap: 1 }),
      entry({ path: "a.js", overlap: 1 }),
      entry({ path: "b.js", overlap: 1 }),
    ];
    const forward = rankResults(entries).map((e) => e.record.source_path);
    const reversed = rankResults([...entries].reverse()).map((e) => e.record.source_path);
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(["a.js", "b.js", "c.js"]);
  });

  it("compareResults returns 0 only for genuinely identical entries", () => {
    const e1 = entry({ path: "a.js", symbol: "x" });
    const e2 = entry({ path: "a.js", symbol: "x" });
    expect(compareResults(e1, e2)).toBe(0);
  });
});
