import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Contract test for the Rung 5 re-review fixes migration. These are the
// database-level guarantees the re-review demanded; if a future edit
// weakens any of them, this fails loudly.
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261005000100_forge_work_management_rung5_fixes.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("rung 5 re-review fixes migration", () => {
  it("enforces at most one current version per family on every write path", () => {
    expect(sql).toContain("uq_forge_work_documents_one_current_version");
    expect(sql).toContain("on forge_work_document_library (owner_id, family_id)");
    expect(sql).toContain("where is_current_version and deleted_at is null");
  });

  it("makes version-number uniqueness unconditional so soft-deleted numbers are never reused", () => {
    expect(sql).toContain("drop index if exists uq_forge_work_documents_family_version");
    expect(sql).toContain("create unique index if not exists uq_forge_work_documents_family_version");
    // The recreated index must NOT carry the old partial predicate.
    const createIdx = sql.slice(sql.indexOf("create unique index if not exists uq_forge_work_documents_family_version"));
    const stmt = createIdx.slice(0, createIdx.indexOf(";"));
    expect(stmt).not.toContain("where deleted_at is null");
  });

  it("computes the next version number over soft-deleted rows too", () => {
    expect(sql).toContain("coalesce(max(version_number), 0) + 1");
    // The max() query must not exclude deleted rows, or it would re-issue
    // a deleted version's number against the unconditional index.
    const fnBody = sql.slice(sql.indexOf("create or replace function forge_work_create_document_version"));
    const maxQuery = fnBody.slice(fnBody.indexOf("coalesce(max(version_number)"), fnBody.indexOf("into v_next_version") + 200);
    expect(fnBody).toContain("and family_id = v_root_id");
    expect(maxQuery).not.toContain("deleted_at is null");
  });

  it("still refuses to version a soft-deleted predecessor", () => {
    const fnBody = sql.slice(sql.indexOf("create or replace function forge_work_create_document_version"));
    expect(fnBody).toContain("version predecessor not found");
  });

  it("adds an orphan-only storage cleanup policy that can never remove referenced files", () => {
    expect(sql).toContain('create policy "work_document_objects_orphan_cleanup"');
    expect(sql).toContain("for delete to authenticated");
    expect(sql).toContain("not exists ( select 1 from forge_work_document_library d");
    expect(sql).toContain("d.object_path = storage.objects.name");
  });
});
