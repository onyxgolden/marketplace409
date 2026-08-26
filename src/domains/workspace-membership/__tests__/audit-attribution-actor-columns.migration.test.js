import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FILE = "20260829001600_fix_audit_attribution_actor_columns.sql";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations", FILE), "utf8").toLowerCase();

function codeOnly(text) {
  return text.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
}

const code = codeOnly(sql);

describe("Audit attribution fix: acting-user columns sourced from auth.uid(), not p_owner_id (checkpoint 5)", () => {
  it("redefines all 3 functions with the fix", () => {
    for (const name of ["review_rental_animal", "approve_simplifi_csv_import", "save_property_financial_setup"]) {
      expect(sql).toContain(`create or replace function public.${name}(`);
    }
  });

  it("review_rental_animal sources both approved_by branches from auth.uid(), not p_owner_id", () => {
    const count = (code.match(/then auth\.uid\(\)::text else null end/g) || []).length;
    expect(count).toBe(2);
    expect(code).not.toContain("then p_owner_id else null end");
  });

  it("approve_simplifi_csv_import sources simplifi_import_batches.created_by from auth.uid(), not p_owner_id", () => {
    expect(code).toContain("p_preview_hash, 'approved', auth.uid()::text, now()");
  });

  it("approve_simplifi_csv_import sources financial_events created_by/updated_by from auth.uid(), not p_owner_id", () => {
    expect(code).toContain("auth.uid()::text,\n      auth.uid()::text\n    )\n    on conflict (owner_id, source_system, source_record_id) do nothing");
  });

  it("save_property_financial_setup sources every created_by/updated_by write from auth.uid(), not p_owner_id", () => {
    // The insert into property_financial_setups, its on-conflict update, and all 3 financial_events
    // inserts (purchase, closing costs, and each acquisition/renovation transaction line) each write
    // created_by/updated_by -- all 5 sites must be converted.
    expect(code).toContain("p_loan_current_balance_as_of, p_loan_interest_rate_bps, auth.uid()::text, auth.uid()::text");
    expect(code).toContain("updated_by = auth.uid()::text,\n    updated_at = now()");
    const singleLinePairCount = (code.match(/auth\.uid\(\)::text, auth\.uid\(\)::text/g) || []).length;
    // 1 in the property_financial_setups insert values line, plus 3 more in the financial_events
    // inserts (purchase, closing costs, transaction loop) -- all 4 share this exact single-line,
    // single-space-after-comma shape.
    expect(singleLinePairCount).toBe(4);
  });

  it("no function in this migration still pairs p_owner_id, p_owner_id as consecutive insert values (the pre-fix audit-column bug shape)", () => {
    expect(code).not.toMatch(/p_owner_id,\s*p_owner_id/);
  });
});
