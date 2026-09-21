// HP-L1 migration contract, checked statically (no docker needed).
//
// The house_plans_regulatory_sources table is DDL-only: this test asserts the
// migration file itself carries the link-only metadata model -- factual
// columns, RLS on the workspace-access pattern, the jurisdiction-state
// vocabulary as a CHECK constraint, https-only official URLs, and no seed
// rows.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../20260921120000_create_house_plans_regulatory_sources.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");

describe("20260921120000_create_house_plans_regulatory_sources (HP-L1, static)", () => {
  it("creates the house_plans_regulatory_sources table", () => {
    expect(sql).toMatch(/create table if not exists house_plans_regulatory_sources/i);
  });

  it("defines exactly the factual metadata columns", () => {
    for (const column of [
      "title",
      "section_identifier",
      "issuing_authority",
      "jurisdiction",
      "edition",
      "effective_date",
      "official_url",
      "topic_tags",
      "provenance",
      "retrieval_date",
      "verification_date",
      "jurisdiction_state",
    ]) {
      expect(sql).toMatch(new RegExp(`(^|\\n)\\s*${column}\\s`, "i"));
    }
  });

  it("has no summary/content/explanation columns", () => {
    for (const banned of ["summary", "content", "description", "explanation", "paraphrase", "interpretation"]) {
      expect(sql).not.toMatch(new RegExp(`(^|\\n)\\s*${banned}\\s+text`, "i"));
    }
  });

  it("enables and forces row level security", () => {
    expect(sql).toMatch(/alter table house_plans_regulatory_sources enable row level security/i);
    expect(sql).toMatch(/alter table house_plans_regulatory_sources force row level security/i);
  });

  it("gates all access on has_workspace_access(owner_id)", () => {
    expect(sql).toMatch(/create policy "house_plans_regulatory_sources_owner_all"/i);
    expect(sql).toMatch(/using \(has_workspace_access\(owner_id\)\)/i);
    expect(sql).toMatch(/with check \(has_workspace_access\(owner_id\)\)/i);
  });

  it("constrains jurisdiction_state to the four spec states", () => {
    expect(sql).toMatch(/check \(jurisdiction_state in \('UNRESOLVED', 'LIKELY', 'CONFIRMED_BY_USER', 'VERIFIED_SOURCE'\)\)/i);
    expect(sql).toMatch(/jurisdiction_state text not null default 'UNRESOLVED'/i);
  });

  it("requires https official URLs", () => {
    expect(sql).toMatch(/official_url text not null check \(official_url like 'https:\/\/%'\)/i);
  });

  it("ships with no seed rows", () => {
    expect(sql).not.toMatch(/insert\s+into/i);
  });
});
