import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Contract test for the Rung 5 revision-guard migration. The re-review
// reproduced two direct-write bypasses against 979ead35 (clearing the only
// current revision; rewriting a historical file reference so orphan cleanup
// could delete the real file). This migration closes both at the trigger
// level, on every write path — if a future edit weakens any of it, this
// fails loudly.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261005000200_forge_work_management_rung5_revision_guard.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("rung 5 revision-guard migration", () => {
  it("installs a before-update guard trigger on the document library", () => {
    expect(sql).toContain("create trigger forge_work_document_library_guard_revision_trg");
    expect(sql).toContain("before update on forge_work_document_library");
    expect(sql).toContain("for each row execute function forge_work_guard_document_revision()");
  });

  it("makes revision identity columns immutable to direct updates", () => {
    for (const column of ["object_path", "version_number", "version_of_document_id", "bucket", "owner_id", "id"]) {
      expect(sql).toContain(`new.${column} is distinct from old.${column}`);
    }
  });

  it("rejects clearing the current revision without a soft delete", () => {
    // true->false is only allowed when deleted_at is set in the same update.
    expect(sql).toContain("only the version rpc may supersede the current revision");
  });

  it("rejects promoting a historical revision to current outside the RPC", () => {
    expect(sql).toContain("only the version rpc may promote a revision to current");
  });

  it("keeps soft delete one-way and working in a single statement", () => {
    expect(sql).toContain("soft delete is one-way");
    // The allowed shape: deleted_at null->timestamp in the same update that
    // clears is_current_version.
    expect(sql).toContain("old.deleted_at is null and new.deleted_at is not null");
  });

  it("lets the version RPC through with a transaction-local flag", () => {
    expect(sql).toContain("set_config('forge_work_documents.version_rpc', 'on', true)");
    expect(sql).toContain("current_setting('forge_work_documents.version_rpc', true) = 'on'");
  });

  it("carries the RPC forward with the flag and keeps its guarantees", () => {
    const fnBody = sql.slice(sql.indexOf("create or replace function forge_work_create_document_version"));
    expect(fnBody).toContain("pg_advisory_xact_lock");
    expect(fnBody).toContain("coalesce(max(version_number), 0) + 1");
    expect(fnBody).toContain("version predecessor not found");
    expect(fnBody).toContain("grant execute on function forge_work_create_document_version");
  });
});
