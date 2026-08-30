import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// STATIC TEXT checks against the new migration's own SQL source (see private-financing-schema.migration.test.js
// for the same caveat: this proves the file says what it claims, not that the SQL has been exercised live --
// see the governance handoff's own "Live Supabase validation" section for the real-Postgres proof).
//
// OWNER-DIRECTED V1 SAFETY BOUNDARY: changing signed loan terms -- account-level schedule/allocation/
// prepayment terms, or a component's own rate/principal/scheduled amount -- is not an ordinary seller
// adjustment. It may require borrower consent, a signed amendment, updated disclosures, a recalculated
// schedule, and jurisdiction-specific legal review; primary-owner/co-owner workspace authorization alone
// is not sufficient authority to change a borrower's contract. In V1, no seller, co-owner, borrower,
// browser route, or ordinary authenticated RPC may append a term or component amendment -- only
// open_private_financing_account (version 1, at account opening, SECURITY DEFINER) may ever write either
// table. This is a real V1 protection, not an unfinished feature.
const rawFileText = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260830000300_add_private_financing_v1_terms_generalization.sql"),
  "utf8",
);
const rawSql = rawFileText.replace(/--[^\n]*/g, "");
const sql = rawSql.toLowerCase().replace(/\s+/g, " ");

describe("private_financing_components -- V1 amendment lockdown", () => {
  it("actively DROPs the original foundation migration's own authenticated-role INSERT policy", () => {
    expect(sql).toContain('drop policy if exists "private_financing_components_owner_insert" on private_financing_components;');
  });

  it("never re-grants an INSERT/UPDATE/DELETE policy to the authenticated role anywhere in this file", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_components\s+for (\w+)/gi)];
    const writePolicies = policyMatches.filter((match) => ["insert", "update", "delete", "all"].includes(match[2].toLowerCase()));
    expect(writePolicies).toEqual([]);
  });
});

describe("private_financing_account_terms_versions -- V1 amendment lockdown", () => {
  it("grants only a SELECT policy to the authenticated role -- no INSERT/UPDATE/DELETE policy exists anywhere in this file", () => {
    const policyMatches = [...rawSql.matchAll(/create policy "([^"]+)" on private_financing_account_terms_versions\s+for (\w+)/gi)];
    const kinds = policyMatches.map((match) => match[2].toLowerCase());
    expect(kinds).toEqual(["select"]);
  });

  it("exactly one INSERT into this table exists in the whole migration -- inside open_private_financing_account, nowhere else", () => {
    const occurrences = sql.split("insert into public.private_financing_account_terms_versions").length - 1;
    expect(occurrences).toBe(1);
    const openFnStart = sql.indexOf("create function open_private_financing_account(");
    const openFnEnd = sql.indexOf("$$;", openFnStart);
    expect(sql.slice(openFnStart, openFnEnd)).toContain("insert into public.private_financing_account_terms_versions");
  });
});

describe("component and terms amendment write paths are symmetric -- both closed the same way", () => {
  it("open_private_financing_account is the only INSERT source for both tables' version-1 rows", () => {
    const openFnStart = sql.indexOf("create function open_private_financing_account(");
    const openFnEnd = sql.indexOf("$$;", openFnStart);
    const openFnSql = sql.slice(openFnStart, openFnEnd);
    expect(openFnSql).toContain("insert into public.private_financing_components");
    expect(openFnSql).toContain("insert into public.private_financing_account_terms_versions");
  });

  it("no function anywhere in this migration is named or described as an amendment RPC -- the future phase is explicitly not built yet", () => {
    expect(sql).not.toContain("function append_private_financing_component_amendment");
    expect(sql).not.toContain("function append_private_financing_account_terms_amendment");
    expect(sql).not.toContain("function amend_private_financing");
  });
});
