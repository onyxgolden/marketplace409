import { describe, expect, it } from "vitest";
import fs from "node:fs"; import path from "node:path";
const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/20261005000000_forge_work_management_rung5.sql"), "utf8");

describe("rung5 documents migration", () => {
  it("creates the private work-documents bucket with office formats", () => {
    expect(sql).toMatch(/insert into storage\.buckets[\s\S]*?'work-documents'/i);
    expect(sql).toMatch(/'application\/pdf'/);
    expect(sql).toMatch(/spreadsheetml\.sheet/);
    expect(sql).toMatch(/wordprocessingml\.document/);
  });

  it("creates forge_work_document_library on the workspace key", () => {
    expect(sql).toMatch(/create table if not exists forge_work_document_library/i);
    expect(sql).toMatch(/primary key\s*\(\s*owner_id\s*,\s*id\s*\)/i);
    expect(sql).toMatch(/unique\s*\(\s*bucket\s*,\s*object_path\s*\)/i);
  });

  it("keeps kind as free text — per-client customizable, never hard-coded", () => {
    expect(sql).toMatch(/kind text not null default 'reference'/i);
    expect(sql).not.toMatch(/kind text[^,;]*check\s*\([^)]*in\s*\(/i);
  });

  it("carries revision control and template-source columns", () => {
    expect(sql).toMatch(/version_of_document_id text/i);
    expect(sql).toMatch(/version_number integer not null default 1/i);
    expect(sql).toMatch(/is_current_version boolean not null default true/i);
    expect(sql).toMatch(/template_source_id text/i);
  });

  it("scopes rows and objects to the workspace, not the individual", () => {
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(/has_workspace_access\(owner_id\)/i);
    expect(sql).toMatch(/has_workspace_access\(\(storage\.foldername\(name\)\)\[1\]\)/);
    expect(sql).not.toMatch(/= auth\.uid\(\)::text/);
  });

  it("ties the object path's first segment to the workspace owner", () => {
    expect(sql).toMatch(/check\s*\(split_part\(object_path,\s*'\/',\s*1\)\s*=\s*owner_id\)/i);
  });

  it("guards revision races with a unique family+version index", () => {
    expect(sql).toMatch(/family_id text[\s\S]*?generated always as \(coalesce\(version_of_document_id, id\)\) stored/i);
    expect(sql).toMatch(/create unique index[\s\S]*?\(owner_id,\s*family_id,\s*version_number\)/i);
  });

  it("soft-deletes: history is never destroyed", () => {
    expect(sql).toMatch(/deleted_at timestamptz/i);
    expect(sql).not.toMatch(/delete from forge_work_document_library/i);
  });

  it("stamps attribution from the authenticated caller, never the payload", () => {
    expect(sql).toMatch(/create or replace function forge_work_stamp_document_actor\(\)/i);
    expect(sql).toMatch(/auth\.uid\(\)::text/);
    expect(sql).toMatch(/missing authenticated identity/);
    expect(sql).toMatch(/NEW\.uploaded_by := v_actor/);
    expect(sql).toMatch(/NEW\.uploaded_by := OLD\.uploaded_by/);
    expect(sql).toMatch(/forge_work_document_library_stamp_actor_trg/);
  });

  it("creates versions atomically: lock, next version, supersede, insert", () => {
    expect(sql).toMatch(/create or replace function forge_work_create_document_version\(/i);
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtext\(p_owner_id \|\| ':' \|\| v_root_id\)\)/);
    expect(sql).toMatch(/coalesce\(max\(version_number\), 0\) \+ 1/);
    expect(sql).toMatch(/set is_current_version = false/);
    expect(sql).toMatch(/has_workspace_access\(p_owner_id\)/);
    expect(sql).toMatch(/grant execute on function forge_work_create_document_version/i);
  });

  it("forbids direct hard deletes of rows and files", () => {
    expect(sql).not.toMatch(/create policy forge_work_document_library_workspace_all/);
    expect(sql).toMatch(/for select to authenticated using \(has_workspace_access\(owner_id\)\)/i);
    expect(sql).toMatch(/for insert to authenticated with check \(has_workspace_access\(owner_id\)\)/i);
    expect(sql).toMatch(/for update to authenticated/i);
    expect(sql).not.toMatch(/for delete to authenticated[^;]*forge_work_document_library/si);
    expect(sql).not.toMatch(/create policy "work_document_objects_workspace_delete"/);
  });
});
