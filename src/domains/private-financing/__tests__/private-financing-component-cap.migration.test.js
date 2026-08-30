import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// STATIC TEXT checks against the migration's own SQL source (see private-financing-schema.migration.test.js
// for the same caveat: this proves the file says what it claims, not that the SQL has been exercised live).
//
// V1's calculation engine (replayEvents.js / paymentAllocation.js) supports at most ONE interest-bearing
// and ONE zero-interest component per account -- never two of the same type, never a third named type.
// This is enforced structurally by the database, not just by convention: component_type's own CHECK
// constraint allows exactly two values, and the (owner_id, account_id, component_type, version_number)
// unique constraint means a second row can never share a type at the same version. This is a deliberate
// V1 scope boundary (see the governance handoff's own "supported capabilities" section), not a South-Main
// leak -- this test exists so the boundary stays a documented, enforced fact instead of quietly drifting
// if a future migration ever touches this table.
const rawFileText = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830000200_create_private_financing_foundation.sql"),
  "utf8",
);
const sql = rawFileText.replace(/--[^\n]*/g, "").toLowerCase().replace(/\s+/g, " ");

describe("private_financing_components -- structural cap at one interest_bearing + one zero_interest component", () => {
  it("component_type accepts exactly the two named values, nothing else", () => {
    expect(sql).toContain("component_type text not null check (component_type in ('interest_bearing', 'zero_interest'))");
  });

  it("(owner_id, account_id, component_type, version_number) is unique -- a second component of the same type at the same version is structurally impossible", () => {
    expect(sql).toContain("unique (owner_id, account_id, component_type, version_number)");
  });
});
