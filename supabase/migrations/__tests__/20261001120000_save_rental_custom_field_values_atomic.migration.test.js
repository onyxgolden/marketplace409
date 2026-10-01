import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static contract check for the R15 atomic-save migration: the RPC exists
// with the expected signature, performs the delete of cleared values and the
// insert of new values inside ONE function body (a single Postgres function
// call is all-or-nothing, which is what makes the save atomic), refuses
// field ids outside the caller's own definitions, is SECURITY INVOKER, and
// is executable by authenticated only.
const sql = fs.readFileSync(
  path.join(process.cwd(), "supabase/migrations/20261001120000_save_rental_custom_field_values_atomic.sql"),
  "utf8",
);
const lower = sql.toLowerCase();

describe("r15 atomic custom-field-values save migration", () => {
  it("creates the save function with the expected signature", () => {
    expect(lower).toContain("create or replace function save_rental_custom_field_values(");
    expect(lower).toContain("p_owner_id text");
    expect(lower).toContain("p_record_id text");
    expect(lower).toContain("p_rows jsonb");
  });

  it("performs delete and insert inside one function body (atomic)", () => {
    const fnCount = (lower.match(/create or replace function save_rental_custom_field_values/g) || []).length;
    expect(fnCount).toBe(1);
    expect(lower).toContain("delete from rental_custom_field_values");
    expect(lower).toContain("insert into rental_custom_field_values");
  });

  it("refuses field ids outside the caller's own definitions", () => {
    expect(lower).toContain("rental_custom_fields f");
    expect(lower).toContain("f.owner_id = p_owner_id");
    expect(lower).toContain("one of the fields is not valid for this record");
  });

  it("clears values by deleting, and skips null values on insert", () => {
    expect(lower).toContain("v.owner_id = p_owner_id");
    expect(lower).toContain("v.record_id = p_record_id");
    expect(lower).toContain("elem ->> 'value_text' is not null");
  });

  it("is security invoker and granted to authenticated only", () => {
    expect(lower).toContain("security invoker");
    expect(lower).toContain(
      "grant execute on function save_rental_custom_field_values(text, text, jsonb) to authenticated",
    );
    expect(lower).toContain("revoke all on function save_rental_custom_field_values(text, text, jsonb) from anon, authenticated");
  });
});
