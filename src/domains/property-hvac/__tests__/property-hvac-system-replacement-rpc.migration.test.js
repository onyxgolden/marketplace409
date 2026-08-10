import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260810000200_replace_property_hvac_system.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("replace property HVAC system RPC", () => {
  it("uses authenticated caller authority", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain("authenticated_owner_id := auth.uid()::text");
    expect(migration).toContain("p_owner_id <> authenticated_owner_id");
    expect(migration).not.toContain("security definer");
  });

  it("locks and validates the current predecessor", () => {
    expect(migration).toContain("where owner_id = p_owner_id and id = required_old_id for update");
    expect(migration).toContain("saved_old.status in ('replaced', 'removed')");
    expect(migration).toContain("saved_old.property_id <> required_property_id");
  });

  it("locks and validates pending owner-scoped evidence", () => {
    expect(migration).toContain("where owner_id = p_owner_id and id = required_evidence_id for update");
    expect(migration).toContain("saved_evidence.review_status <> 'pending_review'");
    expect(migration).toContain("saved_evidence.property_id <> required_property_id");
  });

  it("derives authoritative identities inside the database", () => {
    expect(migration).toContain("'owner_id', p_owner_id");
    expect(migration).toContain("'property_id', required_property_id");
    expect(migration).toContain("'system_id', required_old_id");
    expect(migration).toContain("'system_id', required_new_id");
    expect(migration).not.toContain("p_replacement_system ->> 'owner_id'");
  });

  it("performs the complete lifecycle in one function", () => {
    expect(migration).toContain("update property_hvac_systems set status = 'replaced', condition = 'failed'");
    expect(migration).toContain("insert into property_hvac_systems");
    expect(migration.match(/insert into property_hvac_component_events/g)).toHaveLength(2);
    expect(migration).toContain("insert into property_hvac_components");
    expect(migration).toContain("insert into property_hvac_system_replacements");
  });

  it("approves and links evidence only after lifecycle inserts", () => {
    const transitionInsert = migration.indexOf("insert into property_hvac_system_replacements");
    const evidenceUpdate = migration.indexOf("update property_evidence set hvac_system_id");
    expect(transitionInsert).toBeGreaterThan(-1);
    expect(evidenceUpdate).toBeGreaterThan(transitionInsert);
    expect(migration).toContain("hvac_event_id = required_failure_id");
    expect(migration).toContain("review_status = 'approved'");
  });

  it("makes identical committed retries idempotent", () => {
    expect(migration).toContain("select * into existing_transition");
    expect(migration).toContain("'created', false");
    expect(migration).toContain("'created', true");
    expect(migration).toContain("already exists with different facts");
  });

  it("relies on transaction rollback without destructive cleanup", () => {
    expect(migration).not.toContain("delete from");
    expect(migration).not.toContain("on conflict");
  });

  it("returns every canonical lifecycle record", () => {
    expect(migration).toContain("'predecessor_system', to_jsonb(saved_old)");
    expect(migration).toContain("'replacement_system', to_jsonb(saved_new)");
    expect(migration).toContain("'failure_event', to_jsonb(saved_failure)");
    expect(migration).toContain("'installation_event', to_jsonb(saved_installation)");
    expect(migration).toContain("'initial_components', saved_components");
  });

  it("limits execution to authenticated callers", () => {
    expect(migration).toContain("revoke all on function replace_property_hvac_system");
    expect(migration).toContain("grant execute on function replace_property_hvac_system");
    expect(migration).toContain("to authenticated");
  });
});
