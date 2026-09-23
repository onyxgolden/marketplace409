import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SOURCE_TYPES,
  TEXAS_SOURCES_SEED,
  assertNoForbiddenFields,
  buildSeedRows,
  isAllowedSourceUrl,
  sourceTypeForUrl,
  validateSeedEntry,
} from "../texasSourcesSeed";

describe("texasSourcesSeed (HP-L6)", () => {
  it("holds a small curated index of 6–10 entries", () => {
    expect(TEXAS_SOURCES_SEED.length).toBeGreaterThanOrEqual(6);
    expect(TEXAS_SOURCES_SEED.length).toBeLessThanOrEqual(10);
    expect(Object.isFrozen(TEXAS_SOURCES_SEED)).toBe(true);
  });

  it("every entry passes the metadata-only + official-URL + source-type validation", () => {
    const failures = TEXAS_SOURCES_SEED.map(validateSeedEntry).filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });

  it("carries no forbidden explanatory-text fields", () => {
    expect(assertNoForbiddenFields()).toEqual([]);
  });

  it("has unique official URLs", () => {
    const urls = TEXAS_SOURCES_SEED.map((e) => e.officialUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("covers the sanctioned source types: statute, agency_resource, municipal_reference", () => {
    const types = new Set(TEXAS_SOURCES_SEED.map((e) => e.sourceType));
    expect(types).toEqual(
      new Set([
        SOURCE_TYPES.STATUTE,
        SOURCE_TYPES.AGENCY_RESOURCE,
        SOURCE_TYPES.MUNICIPAL_REFERENCE,
      ])
    );
  });

  it("marks every entry as a verified Texas source", () => {
    for (const entry of TEXAS_SOURCES_SEED) {
      expect(entry.jurisdictionState).toBe("VERIFIED_SOURCE");
      expect(entry.retrievalDate).toBe("2026-09-23");
      expect(entry.verificationDate).toBe("2026-09-23");
    }
  });

  it("sourceTypeForUrl resolves seed URLs and never guesses for unknown URLs", () => {
    expect(sourceTypeForUrl("https://statutes.capitol.texas.gov/Docs/LG/htm/LG.214.htm")).toBe(
      SOURCE_TYPES.STATUTE
    );
    expect(sourceTypeForUrl("https://tdi.texas.gov/tips/need-windstorm-inspection.html")).toBe(
      SOURCE_TYPES.AGENCY_RESOURCE
    );
    expect(sourceTypeForUrl("https://beaumonttexas.gov/707/Building-Codes")).toBe(
      SOURCE_TYPES.MUNICIPAL_REFERENCE
    );
    expect(sourceTypeForUrl("https://example.gov/something")).toBeNull();
    expect(sourceTypeForUrl(null)).toBeNull();
  });

  it("isAllowedSourceUrl requires https on official government domains", () => {
    expect(isAllowedSourceUrl("https://statutes.capitol.texas.gov/Docs/LG/htm/LG.214.htm")).toBe(true);
    expect(isAllowedSourceUrl("https://tdi.texas.gov/tips/need-windstorm-inspection.html")).toBe(true);
    expect(isAllowedSourceUrl("https://beaumonttexas.gov/707/Building-Codes")).toBe(true);
    expect(isAllowedSourceUrl("https://www.portarthurtx.gov/")).toBe(true);
    expect(isAllowedSourceUrl("https://some.county.texas.gov/permits")).toBe(true);
    // http rejected
    expect(isAllowedSourceUrl("http://tdi.texas.gov/tips/x.html")).toBe(false);
    // URL shorteners rejected
    expect(isAllowedSourceUrl("https://bit.ly/abc123")).toBe(false);
    // third-party mirrors rejected even when https
    expect(isAllowedSourceUrl("https://example.com/texas-codes")).toBe(false);
    // garbage rejected
    expect(isAllowedSourceUrl("not a url")).toBe(false);
    expect(isAllowedSourceUrl(null)).toBe(false);
  });

  it("validateSeedEntry rejects forbidden text, bad sourceType, and unofficial URLs", () => {
    const base = TEXAS_SOURCES_SEED[0];
    expect(validateSeedEntry({ ...base, summary: "a summary" }).ok).toBe(false);
    expect(validateSeedEntry({ ...base, sourceType: "statute_guess" }).ok).toBe(false);
    expect(validateSeedEntry({ ...base, officialUrl: "https://bit.ly/x" }).ok).toBe(false);
    expect(validateSeedEntry({ ...base, officialUrl: "http://tdi.texas.gov/x" }).ok).toBe(false);
  });
});

describe("buildSeedRows (HP-L6 owner-scoped seeding)", () => {
  it("maps every seed entry to a DB row for the given owner", () => {
    const rows = buildSeedRows("owner-123");
    expect(rows).toHaveLength(TEXAS_SOURCES_SEED.length);
    for (const row of rows) {
      expect(row.owner_id).toBe("owner-123");
      expect(typeof row.title).toBe("string");
      expect(typeof row.official_url).toBe("string");
    }
  });

  it("is deterministic: repeated calls produce identical rows", () => {
    expect(buildSeedRows("owner-123")).toEqual(buildSeedRows("owner-123"));
  });

  it("is owner-scoped: different owners get the same seed, keyed to their owner_id", () => {
    const a = buildSeedRows("owner-a");
    const b = buildSeedRows("owner-b");
    expect(a.map((r) => r.official_url)).toEqual(b.map((r) => r.official_url));
    expect(a.every((r) => r.owner_id === "owner-a")).toBe(true);
    expect(b.every((r) => r.owner_id === "owner-b")).toBe(true);
  });

  it("never invents an owner: ownerId is taken from the caller", () => {
    const rows = buildSeedRows("e1b22131-9100-4a79-bbe2-b82d43af922e");
    expect(rows[0].owner_id).toBe("e1b22131-9100-4a79-bbe2-b82d43af922e");
  });
});

describe("seed migration (HP-L6) does not drift from the JS seed", () => {
  const migrationPath = resolve(
    __dirname,
    "../../../../supabase/migrations/20260923010000_seed_texas_regulatory_sources.sql"
  );

  it("migration file exists and contains every seed URL exactly once", () => {
    const sql = readFileSync(migrationPath, "utf8");
    for (const entry of TEXAS_SOURCES_SEED) {
      // Count the single-quoted VALUES literal; each row also carries a
      // trailing "-- <url>" readability comment, which is not counted.
      const occurrences = sql.split(`'${entry.officialUrl}'`).length - 1;
      expect(occurrences).toBe(1);
    }
  });

  it("migration is idempotent: insert-if-absent by (owner_id, official_url)", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("where not exists");
    expect(sql).toContain("existing.owner_id = owners.owner_id");
    expect(sql).toContain("existing.official_url = seed.official_url");
  });

  it("migration is owner-scoped: seeds for every auth user, never a hardcoded owner", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("auth.users");
    expect(sql).not.toMatch(/e1b22131-9100-4a79-bbe2-b82d43af922e/);
  });
});
