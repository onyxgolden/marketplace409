import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// STATIC TEXT ASSERTIONS ONLY -- see this migration's own header comment ("STATIC TESTS ARE NOT
// EXECUTION PROOF") and private-financing-schema.migration.test.js's header for the full caveat. These
// tests prove the SQL source says what it claims; they cannot prove runtime RLS/RPC behavior. The
// required live-Postgres validation (`supabase db reset`, then real owner/co-owner/unrelated-user/
// borrower/unrelated-borrower/anonymous access tests) remains outstanding.
const rawFileText = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830000200_create_private_financing_foundation.sql"),
  "utf8",
);
const rawSql = rawFileText.replace(/--[^\n]*/g, "");
const sql = rawSql.toLowerCase().replace(/\s+/g, " ");

function functionBody(sqlText, fnName) {
  const start = sqlText.indexOf(`create or replace function ${fnName}(`);
  const end = sqlText.indexOf(`revoke all on function ${fnName}`);
  return sqlText.slice(start, end === -1 ? start + 4000 : end);
}

describe("private_financing_events -- immutability (requirement D)", () => {
  it("carries no updated_by or updated_at column", () => {
    const start = sql.indexOf("create table if not exists private_financing_events");
    const end = sql.indexOf("create unique index if not exists idx_private_financing_events_idempotency");
    const tableSql = sql.slice(start, end);
    expect(tableSql).not.toContain("updated_by");
    expect(tableSql).not.toContain("updated_at");
  });

  it("grants no UPDATE or DELETE policy to the authenticated role", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_events\s+for (\w+)/gi)];
    const forbiddenPolicies = policyMatches.filter((match) => ["update", "delete"].includes(match[2].toLowerCase()));
    expect(forbiddenPolicies).toEqual([]);
    expect(policyMatches.length).toBeGreaterThan(0);
  });

  it("grants no INSERT policy either -- append_private_financing_event is the only write path", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_events\s+for (\w+)/gi)];
    const insertPolicies = policyMatches.filter((match) => match[2].toLowerCase() === "insert");
    expect(insertPolicies).toEqual([]);
  });

  it("grants no borrower SELECT policy directly on private_financing_events -- only through the guarded RPC", () => {
    const eventsPolicyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_events/gi)];
    expect(eventsPolicyMatches.map((match) => match[1])).toEqual(["private_financing_events_owner_select"]);
  });
});

describe("private_financing_servicing_policy_versions -- immutability and prospective-only versioning (payment-acceptance policy)", () => {
  it("grants no UPDATE or DELETE policy to the authenticated role", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_servicing_policy_versions\s+for (\w+)/gi)];
    const forbiddenPolicies = policyMatches.filter((match) => ["update", "delete"].includes(match[2].toLowerCase()));
    expect(forbiddenPolicies).toEqual([]);
    expect(policyMatches.length).toBeGreaterThan(0);
  });

  it("grants no INSERT policy either -- append_private_financing_servicing_policy_version is the only write path", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_servicing_policy_versions\s+for (\w+)/gi)];
    const insertPolicies = policyMatches.filter((match) => match[2].toLowerCase() === "insert");
    expect(insertPolicies).toEqual([]);
  });

  it("grants no borrower policy at all -- deliberately deferred, no borrower-facing online-payment UI exists yet", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_servicing_policy_versions/gi)];
    expect(policyMatches.map((match) => match[1])).toEqual(["private_financing_servicing_policy_versions_owner_select"]);
  });

  const fnSql = functionBody(sql, "append_private_financing_servicing_policy_version");

  it("exists as a security definer function pinning search_path = public", () => {
    expect(fnSql).toContain("security definer");
    expect(fnSql).toContain("search_path = public");
  });

  it("computes the next version number itself and never accepts one as a caller-supplied parameter", () => {
    const signatureStart = sql.indexOf("create or replace function append_private_financing_servicing_policy_version(");
    const signatureEnd = sql.indexOf(") returns private_financing_servicing_policy_versions", signatureStart);
    const signature = sql.slice(signatureStart, signatureEnd);
    expect(signature).not.toContain("p_version");
    expect(fnSql).toContain("select coalesce(max(version), 0) + 1 into v_next_version");
  });

  it("forces acting_seller_id to the real authenticated user, never trusting a client-supplied value", () => {
    const signatureStart = sql.indexOf("create or replace function append_private_financing_servicing_policy_version(");
    const signatureEnd = sql.indexOf(") returns private_financing_servicing_policy_versions", signatureStart);
    const signature = sql.slice(signatureStart, signatureEnd);
    expect(signature).not.toContain("p_acting_seller_id");
    expect(fnSql).toContain("v_authenticated_user::text");
  });

  it("its only authorization check is has_workspace_access -- no borrower-membership branch exists in it at all, so a borrower can never reach it", () => {
    expect(fnSql).toContain("has_workspace_access(p_owner_id)");
    expect(fnSql).not.toContain("private_financing_account_borrowers");
    expect(fnSql).not.toContain("private_financing_borrowers");
    expect(fnSql).not.toContain("auth_user_id");
  });

  it("rejects an effective_at in the past -- prospective only, at the RPC boundary, not merely by the trigger", () => {
    expect(fnSql).toContain("if p_effective_at < now() then");
  });

  it("enforces strictly-increasing effective_at across a policy's version chain via a trigger, not just a comment", () => {
    expect(sql).toContain("create or replace function enforce_private_financing_servicing_policy_version_ordering()");
    expect(sql).toContain("returns trigger");
    expect(sql).toContain("new.effective_at <= v_max_prior_effective_at");
    expect(sql).toContain("create trigger trg_private_financing_servicing_policy_version_ordering");
    expect(sql).toContain("before insert on private_financing_servicing_policy_versions");
  });

  it("requires a reason for any version beyond the first, exactly like components' amendment_reason requirement", () => {
    expect(sql).toContain("check (version = 1 or reason is not null)");
  });

  it("open_private_financing_account inserts the version-1 policy row in the same transaction, requiring an explicit policy with no default", () => {
    const openFnSql = functionBody(sql, "open_private_financing_account");
    expect(openFnSql).toContain("insert into public.private_financing_servicing_policy_versions");
    expect(openFnSql).toContain("'account_opened'");
  });

  it("is fully decoupled from the ledger, in both directions", () => {
    const appendEventSql = functionBody(sql, "append_private_financing_event");
    expect(appendEventSql).not.toContain("private_financing_servicing_policy_versions");
    expect(appendEventSql).not.toContain("payment_acceptance_policy");
    expect(fnSql).not.toContain("insert into public.private_financing_events");
    expect(fnSql).not.toContain("insert into private_financing_events");
  });
});

describe("Revision 2 -- borrower ledger read boundary is a guarded RPC, not a view", () => {
  const fnSql = functionBody(sql, "read_private_financing_borrower_events");

  it("exists as a security definer function with a fixed safe search_path", () => {
    expect(sql).toContain("create or replace function read_private_financing_borrower_events(p_account_id text)");
    expect(fnSql).toContain("security definer");
    expect(fnSql).toContain("search_path = public");
  });

  it("fully schema-qualifies every table it reads", () => {
    expect(fnSql).toContain("public.private_financing_accounts a");
    expect(fnSql).toContain("public.private_financing_account_borrowers m");
    expect(fnSql).toContain("public.private_financing_borrowers b");
    expect(fnSql).toContain("public.private_financing_events e");
  });

  it("verifies active borrower membership on the SPECIFIC requested account INSIDE the function, before any row can be returned", () => {
    expect(fnSql).toContain("b.auth_user_id = v_authenticated_user");
    expect(fnSql).toContain("m.status = 'active'");
    expect(fnSql).toContain("a.id = p_account_id");
    // The membership check resolves v_owner_id; only after that succeeds does the function proceed.
    const resolveIndex = fnSql.indexOf("into v_owner_id");
    const returnQueryIndex = fnSql.indexOf("return query");
    expect(resolveIndex).toBeGreaterThan(-1);
    expect(returnQueryIndex).toBeGreaterThan(resolveIndex);
  });

  it("returns zero rows (not an error) when the caller has no active membership on the account -- no existence/access side channel", () => {
    const guardIndex = fnSql.indexOf("if v_owner_id is null then");
    expect(guardIndex).toBeGreaterThan(-1);
    const guardBody = fnSql.slice(guardIndex, guardIndex + 60);
    expect(guardBody).toContain("return;");
    expect(guardBody).not.toContain("raise exception");
  });

  it("declares an explicit, fixed return column list that structurally omits internal_note, idempotency_key, created_by, and external_evidence_reference", () => {
    const returnsStart = sql.indexOf("returns table ( id text, account_id text, event_type text, event_origin text, source_reference text,");
    expect(returnsStart).toBeGreaterThan(-1);
    const returnsEnd = sql.indexOf(")", sql.indexOf("payoff_concession_event_id text", returnsStart));
    const returnsList = sql.slice(returnsStart, returnsEnd);
    expect(returnsList).not.toContain("internal_note");
    expect(returnsList).not.toContain("idempotency_key");
    expect(returnsList).not.toContain("created_by");
    expect(returnsList).not.toContain("external_evidence_reference");
  });

  it("the final SELECT list matches the declared return columns -- no column is smuggled through beyond what's declared", () => {
    expect(fnSql).not.toContain("e.internal_note");
    expect(fnSql).not.toContain("e.idempotency_key");
    expect(fnSql).not.toContain("e.created_by");
    expect(fnSql).not.toContain("e.external_evidence_reference");
    expect(fnSql).not.toContain("select *");
  });

  it("revokes PUBLIC execute and grants only to authenticated", () => {
    expect(sql).toContain("revoke all on function read_private_financing_borrower_events(text) from public;");
    expect(sql).toContain("grant execute on function read_private_financing_borrower_events(text) to authenticated;");
  });

  it("a borrower cannot bypass this function by supplying another account id -- the owner_id used for the actual event query is resolved from the caller's OWN verified membership, never taken from any input", () => {
    // p_account_id is the only client-supplied identifier; owner_id is always derived server-side.
    const paramsMatch = fnSql.match(/read_private_financing_borrower_events\(p_account_id text\)/);
    expect(paramsMatch).not.toBeNull();
    expect(fnSql).not.toContain("p_owner_id");
  });
});

describe("Revision 4 -- terms versioning: current-components view respects base-table RLS", () => {
  it("private_financing_current_components uses security_invoker, unlike the removed borrower-events view", () => {
    const viewStart = sql.indexOf("create view private_financing_current_components");
    const viewEnd = sql.indexOf("-- service/webhook", viewStart);
    const viewSql = sql.slice(viewStart, viewEnd === -1 ? viewStart + 500 : viewEnd);
    expect(viewSql).toContain("security_invoker = true");
  });
});

describe("private_financing_components -- insert-only (no destructive UPDATE path)", () => {
  it("grants select and insert only -- no update, no delete", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_components\s+for (\w+)/gi)];
    const kinds = policyMatches.map((match) => match[2].toLowerCase());
    expect(kinds).toContain("select");
    expect(kinds).toContain("insert");
    expect(kinds).not.toContain("update");
    expect(kinds).not.toContain("delete");
  });
});

describe("private_financing_payoff_offers -- guarded transitions, seller-only (Revision 6)", () => {
  it("grants select and insert only on the base table -- no direct update", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_payoff_offers\s+for (\w+)/gi)];
    const kinds = policyMatches.map((match) => match[2].toLowerCase());
    expect(kinds).toContain("select");
    expect(kinds).toContain("insert");
    expect(kinds).not.toContain("update");
    expect(kinds).not.toContain("delete");
  });

  it("only allows a new offer to be inserted as pending", () => {
    expect(sql).toContain("with check (has_workspace_access(owner_id) and status = 'pending')");
  });

  const transitionFnSql = functionBody(sql, "transition_private_financing_payoff_offer_status");

  it("guards every transition through a single function matching the JS ALLOWED_TRANSITIONS state machine", () => {
    expect(sql).toContain("create or replace function transition_private_financing_payoff_offer_status(");
    expect(transitionFnSql).toContain("v_offer.status = 'pending' and p_new_status in ('accepted', 'expired', 'withdrawn', 'cancelled')");
    expect(transitionFnSql).toContain("v_offer.status = 'accepted' and p_new_status in ('paid', 'cancelled')");
  });

  it("its ONLY authorization check is has_workspace_access -- no borrower-membership branch exists in it at all, so a borrower can never reach it", () => {
    expect(transitionFnSql).toContain("has_workspace_access(p_owner_id)");
    expect(transitionFnSql).not.toContain("private_financing_account_borrowers");
    expect(transitionFnSql).not.toContain("private_financing_borrowers");
    expect(transitionFnSql).not.toContain("auth_user_id");
  });

  it("cannot create a concession, close an account, or touch the ledger -- it only ever writes private_financing_payoff_offers", () => {
    expect(transitionFnSql).not.toContain("insert into public.private_financing_events");
    expect(transitionFnSql).not.toContain("insert into private_financing_events");
    expect(transitionFnSql).not.toContain("update public.private_financing_accounts");
    expect(transitionFnSql).not.toContain("update private_financing_accounts");
    expect(transitionFnSql).toContain("update public.private_financing_payoff_offers");
  });

  it("requires qualifying ledger evidence before allowing paid status", () => {
    expect(transitionFnSql).toContain("if p_new_status = 'paid' then");
    expect(transitionFnSql).toContain("qualifying_payment_event_id is required for a paid payoff offer");
    expect(transitionFnSql).toContain("and event_type = 'payment_posted'");
  });
});

describe("Seller-side RLS -- primary_owner and co_owner (requirement F)", () => {
  it("every owner-facing policy on every table reuses has_workspace_access", () => {
    const ownerPolicyBlocks = [...rawSql.matchAll(/create policy "private_financing_\w+_owner_\w+" on \w+[\s\S]*?;/g)];
    expect(ownerPolicyBlocks.length).toBeGreaterThan(0);
    for (const block of ownerPolicyBlocks) {
      expect(block[0].toLowerCase()).toContain("has_workspace_access(owner_id)");
    }
  });

  it("never reassigns a canonical owner_id based on the acting user", () => {
    expect(sql).not.toContain("set owner_id =");
  });
});

describe("Borrower-side RLS isolation (requirement F)", () => {
  it("every borrower policy joins through account_borrowers (membership) and borrowers (identity), requiring auth.uid() and an active/claimed row", () => {
    const borrowerPolicyBlocks = [...rawSql.matchAll(/create policy "[^"]*(?:_borrower_select|_self_select)" on \w+[\s\S]*?;/g)];
    expect(borrowerPolicyBlocks.length).toBeGreaterThan(0);
    for (const block of borrowerPolicyBlocks) {
      const text = block[0].toLowerCase();
      expect(text).toContain("auth.uid()");
      const isMembershipSelfSelect = text.includes("private_financing_account_borrowers_self_select");
      const isIdentitySelfSelect = text.includes("private_financing_borrowers_self_select");
      if (isIdentitySelfSelect) {
        expect(text).toContain("auth_user_id = auth.uid()");
      } else if (isMembershipSelfSelect) {
        expect(text).toContain("private_financing_borrowers");
        expect(text).toContain("b.auth_user_id = auth.uid()");
      } else {
        expect(text).toContain("private_financing_account_borrowers");
        expect(text).toContain("private_financing_borrowers");
        expect(text).toContain("status = 'active'");
      }
    }
  });

  it("grants borrowers select only -- never insert, update, or delete -- on any table", () => {
    const borrowerPolicyMatches = [...rawSql.matchAll(/create policy "[^"]*(?:_borrower_select|_self_select)" on \w+\s+for (\w+)/gi)];
    expect(borrowerPolicyMatches.length).toBeGreaterThan(0);
    for (const match of borrowerPolicyMatches) {
      expect(match[1].toLowerCase()).toBe("select");
    }
  });

  it("a borrower cannot write seller adjustments -- no borrower policy exists for insert/update/delete on components, events, offers, or membership", () => {
    for (const table of [
      "private_financing_components",
      "private_financing_events",
      "private_financing_payoff_offers",
      "private_financing_account_borrowers",
      "private_financing_borrowers",
      "private_financing_servicing_policy_versions",
    ]) {
      const regex = new RegExp(`create policy "[^"]*(?:_borrower_select|_self_select)" on ${table}\\s+for (insert|update|delete)`, "gi");
      expect([...rawSql.matchAll(regex)]).toEqual([]);
    }
  });

  it("a borrower sees only their own identity row and only their own membership rows -- not co-borrowers'", () => {
    expect(sql).toContain("create policy \"private_financing_borrowers_self_select\" on private_financing_borrowers for select to authenticated using (auth_user_id = auth.uid());");
    const membershipPolicy = sql.slice(
      sql.indexOf('create policy "private_financing_account_borrowers_self_select"'),
      sql.indexOf(";", sql.indexOf('create policy "private_financing_account_borrowers_self_select"')) + 1,
    );
    expect(membershipPolicy).toContain("b.auth_user_id = auth.uid()");
  });
});

describe("Service/webhook boundary (requirement F)", () => {
  it("append_private_financing_event rejects stripe_webhook and system_import from the authenticated role", () => {
    const fnSql = functionBody(sql, "append_private_financing_event");
    expect(fnSql).toContain("if p_event_origin not in ('interactive_user', 'manual_import', 'manual_external') then");
  });

  it("grants no function in this migration to any role broader than authenticated", () => {
    const grantMatches = [...rawSql.matchAll(/grant execute on function [\s\S]*? to (\w+);/gi)];
    expect(grantMatches.length).toBeGreaterThan(0);
    for (const match of grantMatches) {
      expect(match[1].toLowerCase()).toBe("authenticated");
    }
  });
});

describe("Truthful attribution (requirement E) -- including the new manual_external origin", () => {
  it("enforces the closed attribution CHECK at the table level", () => {
    expect(sql).toContain(
      "check ( (event_origin in ('interactive_user', 'manual_external') and created_by is not null) or (event_origin not in ('interactive_user', 'manual_external') and created_by is null) )",
    );
  });

  it("forces created_by to the real authenticated user for both interactive_user and manual_external, never trusting a client-supplied value", () => {
    const fnSql = functionBody(sql, "append_private_financing_event");
    expect(fnSql).toContain("if p_event_origin in ('interactive_user', 'manual_external') then p_created_by := v_authenticated_user::text;");
  });

  it("never invents a fake auth user and never falls back to owner_id as an actor", () => {
    expect(sql).not.toContain("coalesce(created_by, owner_id)");
    expect(sql).not.toContain("created_by := owner_id");
    expect(sql).not.toContain("00000000-0000-0000-0000-000000000000");
  });

  it("requires source_reference for stripe_webhook and manual_external; idempotency_key for manual_import, system_import, and manual_external", () => {
    expect(sql).toContain("check (event_origin not in ('stripe_webhook', 'manual_external') or source_reference is not null)");
    expect(sql).toContain("check (event_origin not in ('manual_import', 'system_import', 'manual_external') or idempotency_key is not null)");
  });

  it("manual_external is genuinely distinct from manual_import in the RPC's origin gate and attribution logic, not merely in name", () => {
    const fnSql = functionBody(sql, "append_private_financing_event");
    // manual_import is accepted but never forced to carry created_by; manual_external is accepted AND
    // forced to carry the real authenticated user.
    expect(fnSql).toContain("'manual_import'");
    expect(fnSql).toContain("'manual_external'");
    expect(fnSql).toContain("elsif p_created_by is not null then");
  });
});

describe("Concurrent ledger-sequence allocation (Clarification 2 / Revision 5)", () => {
  const fnSql = functionBody(sql, "append_private_financing_event");

  it("checks authorization BEFORE acquiring the sequence lock", () => {
    const authIndex = fnSql.indexOf("has_workspace_access(p_owner_id)");
    const lockIndex = fnSql.indexOf("for update");
    expect(authIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(authIndex);
  });

  it("locks the account row for update before allocating the next sequence -- never client-side, never MAX()+1", () => {
    expect(fnSql).toContain(
      "select next_ledger_sequence into v_seq from public.private_financing_accounts where owner_id = p_owner_id and id = p_account_id for update;",
    );
    expect(sql).not.toContain("select max(ledger_sequence)");
    expect(sql).not.toContain("select max(sequence)");
  });

  it("never accepts ledger_sequence as a caller-supplied parameter", () => {
    const signatureStart = sql.indexOf("create or replace function append_private_financing_event(");
    const signatureEnd = sql.indexOf(") returns private_financing_events", signatureStart);
    const signature = sql.slice(signatureStart, signatureEnd);
    expect(signature).not.toContain("p_ledger_sequence");
  });

  it("increments the counter only after the event insert succeeds, inside the same transaction (rollback-safe)", () => {
    const insertIndex = fnSql.indexOf("insert into public.private_financing_events");
    const updateIndex = fnSql.indexOf("update public.private_financing_accounts set next_ledger_sequence");
    expect(insertIndex).toBeGreaterThan(-1);
    expect(updateIndex).toBeGreaterThan(insertIndex);
  });

  it("account owner and event owner cannot diverge -- the account lookup itself is scoped by p_owner_id, so a mismatched owner simply finds no row", () => {
    expect(fnSql).toContain("where owner_id = p_owner_id and id = p_account_id");
    expect(fnSql).toContain("if v_seq is null then");
  });
});

describe("SECURITY DEFINER hardening (Revision 5) -- fixed search_path, full qualification, no dynamic SQL", () => {
  it("every security definer function pins search_path = public", () => {
    const definerFunctions = [...rawSql.matchAll(/create or replace function (\w+)\([\s\S]*?security definer[\s\S]*?set search_path = public/g)];
    expect(definerFunctions.length).toBeGreaterThanOrEqual(7);
  });

  it("every private_financing_* table reference inside a function body is schema-qualified with public.", () => {
    for (const fnName of [
      "append_private_financing_event",
      "open_private_financing_account",
      "claim_private_financing_borrower_portal",
      "read_private_financing_borrower_events",
      "transition_private_financing_payoff_offer_status",
      "find_private_financing_external_payment_duplicate_candidates",
      "append_private_financing_servicing_policy_version",
    ]) {
      const fnSql = functionBody(sql, fnName);
      const unqualified = [...fnSql.matchAll(/(?<!public\.)(?<![\w."])(from|into|update|join)\s+private_financing_\w+/g)];
      expect(unqualified).toEqual([]);
    }
  });

  it("uses no dynamic SQL (no EXECUTE, no format()-built statements) anywhere in this migration", () => {
    expect(sql).not.toContain("execute format");
    expect(sql).not.toContain("execute '");
    expect(sql).not.toContain("format(");
  });
});

describe("Duplicate idempotency and duplicate reversal rejection (requirement D)", () => {
  it("has a partial unique index rejecting a duplicate idempotency_key per account", () => {
    expect(sql).toContain(
      "create unique index if not exists idx_private_financing_events_idempotency on private_financing_events (owner_id, account_id, idempotency_key) where idempotency_key is not null;",
    );
  });

  it("has a partial unique index rejecting a duplicate reversal of the same target event", () => {
    expect(sql).toContain(
      "create unique index if not exists idx_private_financing_events_reverses_unique on private_financing_events (owner_id, reverses_event_id) where reverses_event_id is not null;",
    );
  });

  it("also checks both conditions inside the guarded RPC (defense in depth, not constraint-only)", () => {
    const fnSql = functionBody(sql, "append_private_financing_event");
    expect(fnSql).toContain("duplicate idempotency_key for this financing account");
    expect(fnSql).toContain("event has already been reversed and cannot be reversed again");
  });
});

describe("Account/owner reference consistency (requirement D)", () => {
  it("every child table's foreign key into accounts is keyed on the composite (owner_id, id) pair", () => {
    expect(sql).toContain("foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id)");
    const occurrences = sql.split("foreign key (owner_id, account_id) references private_financing_accounts (owner_id, id)").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(4);
  });

  it("append_private_financing_event validates a reversal never crosses financing-account boundaries", () => {
    const fnSql = functionBody(sql, "append_private_financing_event");
    expect(fnSql).toContain("a reversal cannot cross financing-account boundaries");
  });
});

describe("Account-closing events carry no monetary reduction (requirement D)", () => {
  it("the account_closed branch of the per-type CHECK forbids every monetary/delta column", () => {
    const checkStart = sql.indexOf("when event_type = 'account_closed' then");
    const branch = sql.slice(checkStart, checkStart + 800);
    expect(branch).toContain("amount_cents is null");
    expect(branch).toContain("interest_bearing_delta_cents is null and zero_interest_delta_cents is null");
  });
});
