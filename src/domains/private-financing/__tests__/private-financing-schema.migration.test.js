import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Comments are stripped before assertions run -- this migration's own prose deliberately discusses
// forbidden patterns BY NAME to explain why they're absent (e.g. "no foreign key into rental_payments"),
// which would otherwise defeat a naive not.toContain check on the raw text. Positive-presence checks
// against actual code are unaffected either way.
//
// IMPORTANT: every assertion in this file is a STATIC TEXT check against the migration's own SQL
// source. It proves the file says what it claims to say -- it does NOT prove the SQL parses, that any
// function compiles, or that any constraint/policy/grant behaves correctly at runtime. See this
// migration's own header comment for the required live-Postgres validation step
// (`supabase db reset`), which has not been performed in this sandbox.
const rawFileText = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830000200_create_private_financing_foundation.sql"),
  "utf8",
);
const sql = rawFileText.replace(/--[^\n]*/g, "").toLowerCase().replace(/\s+/g, " ");

describe("private financing foundation migration -- table/column/constraint presence", () => {
  it("creates exactly the seven proposed tables, both current-value views, and no borrower-redaction view", () => {
    expect(sql).toContain("create table if not exists private_financing_accounts");
    expect(sql).toContain("create table if not exists private_financing_components");
    expect(sql).toContain("create table if not exists private_financing_borrowers");
    expect(sql).toContain("create table if not exists private_financing_account_borrowers");
    expect(sql).toContain("create table if not exists private_financing_events");
    expect(sql).toContain("create table if not exists private_financing_payoff_offers");
    expect(sql).toContain("create table if not exists private_financing_servicing_policy_versions");
    expect(sql).toContain("create view private_financing_current_components");
    expect(sql).toContain("create view private_financing_current_servicing_policy");
    // The first-draft borrower-redaction view is gone -- replaced by a guarded RPC (Revision 2).
    expect(sql).not.toContain("create view private_financing_borrower_visible_events");
    expect(sql).not.toContain("create table if not exists private_financing_payment_accounts");
    expect(sql).not.toContain("private_financing_event_allocations");
    expect(sql).not.toContain("private_financing_payoff_quotes");
    expect(sql).not.toContain("private_financing_statements");
  });

  it("carries the concurrency-safe ledger_sequence counter and column on both the account and the event", () => {
    expect(sql).toContain("next_ledger_sequence bigint not null default 1 check (next_ledger_sequence > 0)");
    expect(sql).toContain("ledger_sequence bigint not null check (ledger_sequence > 0)");
    expect(sql).toContain("unique (owner_id, account_id, ledger_sequence)");
  });
});

describe("Revision 1 -- borrower identity separated from account membership", () => {
  it("private_financing_borrowers holds only identity/profile fields", () => {
    const start = sql.indexOf("create table if not exists private_financing_borrowers");
    const end = sql.indexOf("create unique index if not exists idx_private_financing_borrowers_owner_email");
    const tableSql = sql.slice(start, end);
    expect(tableSql).toContain("auth_user_id uuid");
    expect(tableSql).toContain("email text not null");
    expect(tableSql).toContain("full_name text");
    expect(tableSql).toContain("phone text");
    // Membership concerns (role/status/dates) must NOT live on the identity table.
    expect(tableSql).not.toContain("role text");
    expect(tableSql).not.toContain("status text");
    expect(tableSql).not.toContain("account_id");
  });

  it("keeps personally sensitive fields minimal -- no SSN, birth date, or identity-document columns anywhere", () => {
    for (const forbidden of ["ssn", "social_security", "date_of_birth", "birth_date", "drivers_license", "passport", "id_document", "identity_document"]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("private_financing_account_borrowers holds role, status, and every invitation/claim/revocation date", () => {
    const start = sql.indexOf("create table if not exists private_financing_account_borrowers");
    const end = sql.indexOf("-- the immutable ledger");
    const tableSql = sql.slice(start, end);
    expect(tableSql).toContain("role text not null check (role in ('primary_borrower', 'co_borrower', 'guarantor'))");
    expect(tableSql).toContain("status text not null check (status in ('invited', 'active', 'suspended', 'revoked'))");
    expect(tableSql).toContain("invited_at timestamptz not null default now()");
    expect(tableSql).toContain("activated_at timestamptz");
    expect(tableSql).toContain("revoked_at timestamptz");
    expect(tableSql).toContain("foreign key (owner_id, borrower_id) references private_financing_borrowers (owner_id, id)");
  });

  it("supports multiple borrowers on one account and one borrower on multiple accounts (South Main names two borrowers)", () => {
    // Uniqueness is on (account, borrower) -- NOT on account alone -- so a second, distinct borrower_id
    // can freely have its own membership row against the same account_id (multiple borrowers per
    // account), and a single borrower_id can appear in membership rows under multiple account_ids
    // (one borrower, multiple accounts) since nothing constrains borrower_id to a single row.
    expect(sql).toContain("unique (owner_id, account_id, borrower_id)");
    expect(sql).not.toContain("unique (owner_id, account_id)");
  });

  it("scopes borrower identity per owner_id, matching rental_tenants' own established pattern, never a global cross-seller table", () => {
    const start = sql.indexOf("create table if not exists private_financing_borrowers");
    const end = sql.indexOf("create unique index if not exists idx_private_financing_borrowers_owner_email");
    const tableSql = sql.slice(start, end);
    expect(tableSql).toContain("owner_id text not null");
    expect(tableSql).toContain("primary key (owner_id, id)");
  });
});

describe("Revision 3 -- property linkage resolved: omitted, not left as a misleading loose reference", () => {
  it("private_financing_accounts has no property_id column at all", () => {
    const start = sql.indexOf("create table if not exists private_financing_accounts");
    const end = sql.indexOf("-- terms are insert-only");
    const tableSql = sql.slice(start, end);
    expect(tableSql).not.toContain("property_id");
  });

  it("open_private_financing_account no longer accepts a property_id parameter", () => {
    const start = sql.indexOf("create or replace function open_private_financing_account(");
    const end = sql.indexOf("returns private_financing_accounts", start);
    const signature = sql.slice(start, end);
    expect(signature).not.toContain("p_property_id");
  });
});

describe("Revision 4 -- membership-safe terms versioning", () => {
  it("component identity is stable across versions via a composite unique constraint", () => {
    expect(sql).toContain("unique (owner_id, account_id, component_type, version_number)");
  });

  it("enforces strictly-increasing effective dates across a component's version chain via a trigger, not just a comment", () => {
    expect(sql).toContain("create or replace function enforce_private_financing_component_version_ordering()");
    expect(sql).toContain("returns trigger");
    expect(sql).toContain("new.effective_date <= v_max_prior_effective_date");
    expect(sql).toContain("create trigger trg_private_financing_component_version_ordering");
    expect(sql).toContain("before insert on private_financing_components");
  });

  it("provides a safe current-terms read path that cannot be confused with a second principal component", () => {
    expect(sql).toContain("create view private_financing_current_components");
    expect(sql).toContain("security_invoker = true");
    expect(sql).toContain("distinct on (owner_id, account_id, component_type)");
    expect(sql).toContain("order by owner_id, account_id, component_type, version_number desc");
  });

  it("requires a full amendment lineage (prior_version_id, amendment_reason, acting_seller_id) for any version beyond the first", () => {
    expect(sql).toContain(
      "check (version_number = 1 or (prior_version_id is not null and amendment_reason is not null and acting_seller_id is not null))",
    );
  });
});

describe("NEW -- external/off-platform payment recording (Venmo, Cash App, Zelle, etc.)", () => {
  it("adds manual_external as a distinct event_origin, alongside the four existing origins", () => {
    expect(sql).toContain(
      "event_origin text not null check (event_origin in ( 'interactive_user', 'stripe_webhook', 'system_import', 'manual_import', 'manual_external' ))",
    );
  });

  it("adds payment_method and external_evidence_reference as new nullable columns on the event row", () => {
    expect(sql).toContain("payment_method text check (payment_method is null or payment_method in (");
    expect(sql).toContain("'venmo', 'cash_app', 'zelle', 'paypal', 'bank_transfer', 'cash', 'check', 'money_order', 'other'");
    expect(sql).toContain("external_evidence_reference text");
  });

  it("requires payment_method for a manual_external payment_posted event, and forbids both new columns on every other event type", () => {
    expect(sql).toContain("check (event_type <> 'payment_posted' or event_origin <> 'manual_external' or payment_method is not null)");
    expect(sql).toContain("check (event_type = 'payment_posted' or (payment_method is null and external_evidence_reference is null))");
  });

  it("provides a read-only, owner-gated duplicate-candidate finder that never blocks or auto-rejects", () => {
    const start = sql.indexOf("create or replace function find_private_financing_external_payment_duplicate_candidates(");
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf("revoke all on function find_private_financing_external_payment_duplicate_candidates");
    const fnSql = sql.slice(start, end);
    expect(fnSql).toContain("stable");
    // This function only ever raises on missing auth/authorization -- never on finding a candidate.
    expect(fnSql).not.toContain("raise exception 'duplicate");
    expect(fnSql).not.toContain("update ");
    expect(fnSql).not.toContain("insert into");
  });

  it("keeps manual_import (historical reconstruction) and manual_external (newly received payment) attribution genuinely distinct", () => {
    expect(sql).toContain(
      "check ( (event_origin in ('interactive_user', 'manual_external') and created_by is not null) or (event_origin not in ('interactive_user', 'manual_external') and created_by is null) )",
    );
    expect(sql).toContain(
      "check (event_origin not in ('manual_import', 'system_import', 'manual_external') or idempotency_key is not null)",
    );
  });
});

describe("NEW 2 -- payment-acceptance policy (owner-approved requirement)", () => {
  it("declares a single closed three-value enum, never two independent booleans", () => {
    expect(sql).toContain(
      "payment_acceptance_policy text not null check (payment_acceptance_policy in ( 'partial_allowed', 'full_amount_or_more', 'exact_amount_only' ))",
    );
    expect(sql).not.toContain("require_full_payment boolean");
    expect(sql).not.toContain("allow_extra_principal boolean");
  });

  it("requires payment_acceptance_policy to be explicitly supplied at account opening, never defaulted", () => {
    const start = sql.indexOf("create or replace function open_private_financing_account(");
    const end = sql.indexOf("returns private_financing_accounts", start);
    const signature = sql.slice(start, end);
    expect(signature).toContain("p_payment_acceptance_policy text,");
    expect(signature).not.toContain("p_payment_acceptance_policy text default");
  });

  it("fails closed on an unrecognized payment_acceptance_policy at both RPC boundaries", () => {
    expect(sql).toContain("if p_payment_acceptance_policy not in ('partial_allowed', 'full_amount_or_more', 'exact_amount_only') then");
    const occurrences = sql.split("if p_payment_acceptance_policy not in ('partial_allowed', 'full_amount_or_more', 'exact_amount_only') then").length - 1;
    expect(occurrences).toBe(2);
  });

  it("is append-only and versioned: version must be a positive integer, unique per account, and a reason is required beyond version 1", () => {
    const start = sql.indexOf("create table if not exists private_financing_servicing_policy_versions");
    const end = sql.indexOf("create or replace function enforce_private_financing_servicing_policy_version_ordering");
    const tableSql = sql.slice(start, end);
    expect(tableSql).toContain("version integer not null check (version > 0)");
    expect(tableSql).toContain("unique (owner_id, account_id, version)");
    expect(tableSql).toContain("check (version = 1 or reason is not null)");
    expect(tableSql).toContain("acting_seller_id text not null");
  });

  it("enforces prospective-only, strictly-increasing effective_at across a policy's version chain via a trigger", () => {
    expect(sql).toContain("create or replace function enforce_private_financing_servicing_policy_version_ordering()");
    expect(sql).toContain("new.effective_at <= v_max_prior_effective_at");
    expect(sql).toContain("create trigger trg_private_financing_servicing_policy_version_ordering");
    expect(sql).toContain("before insert on private_financing_servicing_policy_versions");
  });

  it("the guarded RPC additionally rejects an effective_at in the past outright, never trusting the trigger alone", () => {
    const start = sql.indexOf("create or replace function append_private_financing_servicing_policy_version(");
    const end = sql.indexOf("revoke all on function append_private_financing_servicing_policy_version", start);
    const fnSql = sql.slice(start, end);
    expect(fnSql).toContain("if p_effective_at < now() then");
    expect(fnSql).toContain("prospective only, never retroactive");
    expect(fnSql).toContain("effective_at cannot be in the past");
  });

  it("the guarded RPC computes version and acting_seller_id itself, never trusting a caller-supplied value", () => {
    const start = sql.indexOf("create or replace function append_private_financing_servicing_policy_version(");
    const end = sql.indexOf("revoke all on function append_private_financing_servicing_policy_version", start);
    const fnSql = sql.slice(start, end);
    expect(fnSql).not.toContain("p_version");
    expect(fnSql).not.toContain("p_acting_seller_id");
    expect(fnSql).toContain("coalesce(max(version), 0) + 1");
    expect(fnSql).toContain("v_authenticated_user::text");
  });

  it("its only authorization check is has_workspace_access -- no borrower-membership branch exists in it at all", () => {
    const start = sql.indexOf("create or replace function append_private_financing_servicing_policy_version(");
    const end = sql.indexOf("revoke all on function append_private_financing_servicing_policy_version", start);
    const fnSql = sql.slice(start, end);
    expect(fnSql).toContain("has_workspace_access(p_owner_id)");
    expect(fnSql).not.toContain("private_financing_account_borrowers");
    expect(fnSql).not.toContain("private_financing_borrowers");
    expect(fnSql).not.toContain("auth_user_id");
  });

  it("provides a current-servicing-policy read path respecting base-table RLS, mirroring current-components", () => {
    const start = sql.indexOf("create view private_financing_current_servicing_policy");
    const end = sql.indexOf("-- service/webhook", start);
    const viewSql = sql.slice(start, end === -1 ? start + 500 : end);
    expect(viewSql).toContain("security_invoker = true");
    expect(viewSql).toContain("distinct on (owner_id, account_id)");
    expect(viewSql).toContain("where effective_at <= now()");
  });

  it("is fully decoupled from the ledger, in both directions -- neither RPC references the other's table", () => {
    const appendEventStart = sql.indexOf("create or replace function append_private_financing_event(");
    const appendEventEnd = sql.indexOf("revoke all on function append_private_financing_event", appendEventStart);
    const appendEventSql = sql.slice(appendEventStart, appendEventEnd);
    expect(appendEventSql).not.toContain("private_financing_servicing_policy_versions");
    expect(appendEventSql).not.toContain("payment_acceptance_policy");

    const appendPolicyStart = sql.indexOf("create or replace function append_private_financing_servicing_policy_version(");
    const appendPolicyEnd = sql.indexOf("revoke all on function append_private_financing_servicing_policy_version", appendPolicyStart);
    const appendPolicySql = sql.slice(appendPolicyStart, appendPolicyEnd);
    expect(appendPolicySql).not.toContain("insert into public.private_financing_events");
    expect(appendPolicySql).not.toContain("insert into private_financing_events");
  });

  it("manual_import and manual_external event_origin values are ungated by any policy check -- historical and off-platform payments remain recordable regardless of the configured online policy", () => {
    const fnSql = sql.slice(
      sql.indexOf("create or replace function append_private_financing_event("),
      sql.indexOf("revoke all on function append_private_financing_event"),
    );
    expect(fnSql).toContain("'manual_import'");
    expect(fnSql).toContain("'manual_external'");
    expect(fnSql).not.toContain("payment_acceptance_policy");
  });
});

describe("private financing foundation migration -- exact data types (requirement C)", () => {
  it("uses bigint for every posted-money column, never a floating-point type", () => {
    expect(sql).not.toContain("double precision");
    expect(sql).not.toContain(" real,");
    expect(sql).not.toContain(" real ");
    expect(sql).not.toContain("numeric");
    expect(sql).not.toContain("float");
    expect(sql).toContain("origination_principal_cents bigint not null");
    expect(sql).toContain("amount_cents bigint check");
    expect(sql).toContain("interest_paid_cents bigint check");
    expect(sql).toContain("calculated_payoff_cents bigint not null check (calculated_payoff_cents >= 0)");
  });

  it("uses date for effective dates and timestamptz for recorded timestamps", () => {
    expect(sql).toContain("effective_date date not null");
    expect(sql).toContain("recorded_at timestamptz not null default now()");
    expect(sql).toContain("opened_date date not null");
    expect(sql).toContain("issued_at date not null");
  });

  it("uses text + CHECK for every enumerated value, matching repository convention (no native enum type)", () => {
    expect(sql).not.toContain("create type");
    expect(sql).toContain("check (event_type in (");
    expect(sql).toContain("check (status in ('pending', 'accepted', 'expired', 'withdrawn', 'paid', 'cancelled')");
  });

  it("never stores a mutable running balance or a mutable accrued-interest total", () => {
    expect(sql).not.toContain("running_balance");
    expect(sql).not.toContain("current_balance");
    expect(sql).not.toContain("accrued_interest_total");
    expect(sql).not.toContain("payoff_amount_cents");
  });

  it("generates every id server-side via gen_random_uuid(), never accepting a client-supplied id", () => {
    expect(sql).toContain("'pf_evt_' || gen_random_uuid()::text");
    expect(sql).toContain("'pf_acct_' || gen_random_uuid()::text");
    expect(sql).toContain("'pf_comp_' || gen_random_uuid()::text");
    expect(sql).toContain("'pf_pol_' || gen_random_uuid()::text");
  });
});

describe("private financing foundation migration -- financial separation (requirement B)", () => {
  it("has no foreign key or reference into rental_payments", () => {
    expect(sql).not.toContain("rental_payments");
  });

  it("never references financial_accounts, so 'loan' can never be misclassified as a liability here", () => {
    expect(sql).not.toContain("financial_accounts");
    expect(sql).not.toContain("type = 'loan'");
  });

  it("never references or alters landlord_payment_accounts", () => {
    expect(sql).not.toContain("landlord_payment_accounts");
  });

  it("never creates private_financing_payment_accounts or touches Financial FORGE posting (financial_events)", () => {
    expect(sql).not.toContain("private_financing_payment_accounts");
    expect(sql).not.toContain("insert into financial_events");
    expect(sql).not.toContain("insert into public.financial_events");
  });
});

describe("private financing foundation migration -- Clarification 1 (South Main late charges)", () => {
  it("keeps late_fee_policy schema-extensible (not permanently locked to disabled)", () => {
    expect(sql).toContain("late_fee_policy text not null check (late_fee_policy in ('disabled', 'enabled')) default 'disabled'");
  });

  it("fails closed on 'enabled' at the RPC boundary, not by forbidding the value in the schema", () => {
    expect(sql).toContain("if p_late_fee_policy = 'enabled' then");
    expect(sql).toContain("is not yet supported: no late fee calculation is implemented");
  });

  it("implements no late-fee calculation or posting of any kind", () => {
    expect(sql).not.toContain("late_charge");
    expect(sql).not.toContain("late_fee_cents");
    expect(sql).not.toContain("compute_late_fee");
  });
});

describe("static tests are not execution proof", () => {
  it("the migration's own header explicitly states this and names the required live-Postgres validation command", () => {
    expect(rawFileText).toContain("STATIC TESTS ARE NOT EXECUTION PROOF");
    expect(rawFileText).toContain("supabase db reset");
  });
});
