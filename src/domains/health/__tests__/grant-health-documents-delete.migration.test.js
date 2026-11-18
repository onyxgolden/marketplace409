import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261118010000_grant_health_documents_delete.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

// Mirrors 20260904000100_grant_health_update_delete.sql's own (untested) shape exactly -- a
// one-line column-level grant widening, relying on the base migration's existing RLS policy
// (20260901000700_create_private_health_tracker.sql's "for all to authenticated" policy) to do
// the actual authorization. This test just proves the grant text itself is present and correctly
// scoped, same posture as every other one-line grant migration in this area of the codebase.
describe("grant health_documents delete migration", () => {
  it("grants delete on health_documents to authenticated only", () => {
    expect(sql).toMatch(/grant delete on public\.health_documents to authenticated/);
  });

  it("never widens delete to anon or service_role", () => {
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*health_documents[^;]*anon/);
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*health_documents[^;]*service_role/);
  });
});
