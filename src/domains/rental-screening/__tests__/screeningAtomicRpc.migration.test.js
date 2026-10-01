import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Structural contract test for the R22 atomic-transition migration —
// supabase/migrations/20261001143000_rental_screening_atomic_transitions.sql.
//
// ChatGPT's blocking NO-GO on PR #527 (finding 1): screening state
// mutations and their append-only audit events were separate database
// requests, so a result-bearing/completed screening could commit with no
// audit event. This migration fixes it with three RPCs, each performing the
// mutation + the event append(s) inside ONE database transaction.
//
// Like every migration test in this repo, this is structural by design: it
// pins the shipped artifact's contract, not a live database.

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001143000_rental_screening_atomic_transitions.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("screening atomic-transition migration", () => {
  it("defines all three RPCs with their exact signatures", () => {
    expect(sql).toContain("create or replace function request_screening( p_owner_id text, p_application_id text, p_token text, p_consent_verified_on_application boolean, p_consent_recorded boolean, p_requested_by text )");
    expect(sql).toContain("create or replace function transition_screening( p_owner_id text, p_screening_id text, p_action text, p_actor_user_id text, p_payload jsonb )");
    expect(sql).toContain("create or replace function record_applicant_screening_info( p_token text, p_consent_text text, p_applicant_provided jsonb )");
  });

  it("every RPC is security invoker with an explicit search_path", () => {
    // (The header comment also says "security invoker" once — count the
    // actual function declarations, not the prose.)
    const invokerCount = (sql.match(/language plpgsql security invoker/g) || []).length;
    expect(invokerCount).toBe(3);
    const pathCount = (sql.match(/set search_path = public/g) || []).length;
    expect(pathCount).toBe(3);
  });

  it("request_screening re-verifies pending status + consent INSIDE the transaction (fail closed)", () => {
    expect(sql).toContain("if v_app.status <> 'pending' then raise exception 'screening_conflict: screening can only be requested on a pending application.'");
    expect(sql).toContain("if not (coalesce((v_app.answers ->> 'consent') = 'true', false) or coalesce(p_consent_recorded, false)) then raise exception 'screening_conflict: applicant screening consent is not recorded.'");
    expect(sql).toContain("insert into rental_application_screenings");
    expect(sql).toContain("values ( effective_owner_id, v_row.id, p_application_id, 'requested'");
  });

  it("request_screening maps the open-screening unique violation to a clean conflict", () => {
    expect(sql).toContain("when unique_violation then");
    expect(sql).toContain("raise exception 'screening_conflict: a screening is already open on this application.'");
  });

  it("transition_screening locks the row (FOR UPDATE) and covers every action", () => {
    expect(sql).toContain("from rental_application_screenings where owner_id = effective_owner_id and id = p_screening_id for update");
    for (const action of ["mark_in_progress", "record_results", "set_recommendation", "complete", "regenerate_token", "provider_attempt_blocked"]) {
      expect(sql).toContain(`if p_action = '${action}' then`);
    }
  });

  it("transition_screening appends the audit event in the same transaction as the mutation", () => {
    expect(sql).toContain("insert into rental_screening_events (owner_id, screening_id, application_id, event, actor_user_id, note) values (effective_owner_id, p_screening_id, v_row.application_id, v_event, v_actor, v_note)");
  });

  it("record_results writes results_recorded_at atomically with the results (finding 2)", () => {
    expect(sql).toContain("results_recorded_at = v_now");
  });

  it("complete uses results_recorded_at as the primary evidence of recorded results", () => {
    expect(sql).toContain("if v_row.results_recorded_at is null");
  });

  it("record_applicant_screening_info appends BOTH consent events in the same transaction as the consent update", () => {
    expect(sql).toContain("where screening_token = p_token for update");
    expect(sql).toContain("(v_row.owner_id, v_row.id, v_row.application_id, 'consent_recorded', null, 'applicant confirmed screening consent through the link.')");
    expect(sql).toContain("(v_row.owner_id, v_row.id, v_row.application_id, 'applicant_info_received', null, 'applicant submitted screening info through the link.')");
  });

  it("error prefixes map cleanly to route statuses (409/400/404/410)", () => {
    for (const prefix of ["screening_conflict", "screening_invalid", "screening_not_found", "screening_closed"]) {
      expect(sql).toContain(prefix);
    }
  });

  it("least privilege: workspace RPCs are authenticated-only, the applicant RPC is service_role-only", () => {
    expect(sql).toContain("revoke all on function request_screening(text, text, text, boolean, boolean, text) from public");
    expect(sql).toContain("grant execute on function request_screening(text, text, text, boolean, boolean, text) to authenticated");
    expect(sql).toContain("revoke all on function transition_screening(text, text, text, text, jsonb) from public");
    expect(sql).toContain("grant execute on function transition_screening(text, text, text, text, jsonb) to authenticated");
    expect(sql).toContain("revoke all on function record_applicant_screening_info(text, text, jsonb) from public");
    expect(sql).toContain("grant execute on function record_applicant_screening_info(text, text, jsonb) to service_role");
  });
});
