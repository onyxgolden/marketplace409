import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260825000000_extend_rental_document_library.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("rental_documents extension for property-level documents", () => {
  it("makes lease_id optional and requires at least a lease or a property", () => {
    expect(sql).toContain("alter table rental_documents alter column lease_id drop not null");
    expect(sql).toContain("check(lease_id is not null or property_id is not null)");
  });

  it("never allows a property-only (leaseless) document to be tenant-visible", () => {
    expect(sql).toContain("check(tenant_visible = false or lease_id is not null)");
  });

  it("adds the standardized property-level document categories alongside the existing lease ones", () => {
    for (const category of [
      "lease", "addendum", "notice", "inspection", "receipt", "other",
      "survey_plat", "deed", "title_policy", "insurance_policy", "tax_document", "appraisal", "permit", "warranty", "hoa_document",
    ]) {
      expect(sql).toContain(`'${category}'`);
    }
  });

  it("adds searchable extracted text via a generated, weighted, indexed tsvector", () => {
    expect(sql).toContain("extracted_text text");
    expect(sql).toContain("search_vector tsvector generated always as");
    expect(sql).toContain("setweight(to_tsvector('english', coalesce(title, '')), 'a')");
    expect(sql).toContain("using gin(search_vector)");
  });

  it("supports version history rooted at the family's first document, never chained hop-by-hop", () => {
    expect(sql).toContain("version_of_document_id text");
    expect(sql).toContain("version_number integer not null default 1");
    expect(sql).toContain("is_current_version boolean not null default true");
    expect(sql).toContain("foreign key (owner_id, version_of_document_id) references rental_documents(owner_id, id) on delete restrict");
  });

  it("adds expiration tracking and an indexed lookup for it", () => {
    expect(sql).toContain("expires_at date");
    expect(sql).toContain("idx_rental_documents_owner_expires");
  });

  it("adds audit metadata and soft-delete (never a hard delete) on rental_documents itself", () => {
    expect(sql).toContain("created_by text");
    expect(sql).toContain("updated_by text");
    expect(sql).toContain("deleted_at timestamptz");
  });

  it("creates an append-only audit log table with no update or delete grant", () => {
    expect(sql).toContain("create table if not exists rental_document_audit_log");
    expect(sql).toContain("action text not null check(action in ('uploaded', 'versioned', 'edited', 'deleted', 'downloaded', 'category_changed'))");
    expect(sql).toContain("foreign key (owner_id, document_id) references rental_documents(owner_id, id) on delete cascade");
    expect(sql).toContain("grant select, insert on rental_document_audit_log to authenticated");
    expect(sql).not.toContain("grant update on rental_document_audit_log");
    expect(sql).not.toContain("grant delete on rental_document_audit_log");
  });

  it("owner-scopes the audit log with RLS, forced", () => {
    expect(sql).toContain("alter table rental_document_audit_log enable row level security");
    expect(sql).toContain("alter table rental_document_audit_log force row level security");
    expect(sql).toContain("rental_document_audit_log_owner_select");
    expect(sql).toContain("rental_document_audit_log_owner_insert");
  });
});
