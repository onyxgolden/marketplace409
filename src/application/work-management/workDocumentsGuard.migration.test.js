import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Contract test for the Rung 5 revision-guard v2 migration. The re-review
// reproduced a bypass of the v1 guard against 8fd7792f: the trigger's
// bypass flag was a caller-writable GUC, so direct SQL could set it (or
// ride the RPC's flag inside one transaction) and wave the history rewrite
// through. V2 eliminates the bypass state entirely: a deferred constraint
// trigger enforces the invariant at COMMIT on every write path. If a
// future edit reintroduces caller-writable bypass state, this fails loudly.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261005000300_forge_work_management_rung5_revision_guard_v2.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("rung 5 revision-guard v2 migration", () => {
  it("contains no caller-writable bypass flag", () => {
    expect(sql).not.toContain("version_rpc");
    expect(sql).not.toContain("set_config(");
    expect(sql).not.toContain("current_setting(");
  });

  it("installs a deferred constraint trigger enforcing the current-revision invariant", () => {
    expect(sql).toContain("create constraint trigger forge_work_document_library_current_guard_trg");
    expect(sql).toContain("after insert or update on forge_work_document_library");
    expect(sql).toContain("deferrable initially deferred");
    expect(sql).toContain("for each row execute function forge_work_check_document_current()");
  });

  it("rejects a family left with no current revision unless its latest version was soft-deleted", () => {
    expect(sql).toContain("has no current revision");
    // The escape hatch is exactly the API's soft delete: latest version deleted.
    expect(sql).toContain("order by version_number desc");
    expect(sql).toContain("deleted_at is not null");
  });

  it("keeps revision identity immutable in the row trigger", () => {
    for (const column of ["object_path", "version_number", "version_of_document_id", "bucket", "owner_id", "id"]) {
      expect(sql).toContain(`new.${column} is distinct from old.${column}`);
    }
  });

  it("keeps soft delete one-way and rejects direct promotion", () => {
    expect(sql).toContain("soft delete is one-way");
    expect(sql).toContain("only the version rpc may promote a revision to current");
  });

  it("carries the RPC forward with its guarantees and no flag machinery", () => {
    const fnBody = sql.slice(sql.indexOf("create or replace function forge_work_create_document_version"));
    expect(fnBody).toContain("pg_advisory_xact_lock");
    expect(fnBody).toContain("coalesce(max(version_number), 0) + 1");
    expect(fnBody).toContain("version predecessor not found");
    expect(fnBody).toContain("grant execute on function forge_work_create_document_version");
  });
});
