import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20260901000700_create_private_health_tracker.sql"), "utf8").toLowerCase().replace(/\s+/g, " ");

describe("private household health tracker migration", () => {
  it("uses an explicit health allowlist independent from general workspace access", () => {
    expect(sql).toContain("create table public.health_workspace_members");
    expect(sql).toContain("health_has_workspace_access");
    expect(sql).toContain("only the primary owner and the single active co-owner");
    expect(sql).not.toMatch(/public\.has_workspace_access\(/);
  });

  it("supports member and non-login managed-dependent profiles", () => {
    expect(sql).toContain("'member', 'managed_dependent'");
    expect(sql).toContain("add_health_managed_dependent");
    expect(sql).toContain("managed_by uuid");
  });

  it("tracks polypharmacy, conditions, clinicians and insurance continuity", () => {
    for (const table of ["health_conditions", "health_care_team", "health_regimen_items", "health_provider_insurance_history"]) expect(sql).toContain(`create table public.${table}`);
    expect(sql).toContain("refills_remaining");
    expect(sql).toContain("acceptance_status");
  });

  it("tracks records requests and medical representative authority", () => {
    expect(sql).toContain("create table public.health_record_requests");
    expect(sql).toContain("medical_power_of_attorney");
    expect(sql).toContain("health_authorization_verifications");
  });

  it("preserves an append-only actor-attributed change history", () => {
    expect(sql).toContain("create table public.health_audit_log");
    expect(sql).toContain("audit_health_record_change");
    expect(sql).toContain("actor_id");
    expect(sql).toContain("grant select on public.health_audit_log");
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*health_audit_log/);
  });

  it("keeps source documents private and requires extraction review", () => {
    expect(sql).toContain("values('health-documents','health-documents',false");
    expect(sql).toContain("create table public.health_documents");
    expect(sql).toContain("create table public.health_extraction_proposals");
    expect(sql).toContain("'pending_review','confirmed','rejected'");
    expect(sql).toContain("health_document_object_select");
    expect(sql).not.toContain("health-documents','health-documents',true");
  });

  it("confirms reviewed fields atomically without trusting OCR flags", () => {
    expect(sql).toContain("confirm_health_extraction_proposal");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("v_proposal.status <> 'pending_review'");
    expect(sql).toContain("then item->>'flag' else 'unknown'");
    expect(sql).toContain("set status = 'confirmed', reviewed_data = p_reviewed_data");
    expect(sql).toContain("set review_status = 'confirmed'");
  });
});
