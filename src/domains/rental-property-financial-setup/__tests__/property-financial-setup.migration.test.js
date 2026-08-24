import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260824060000_add_property_financial_setup.sql"),
  "utf8",
).toLowerCase().replace(/\s+/g, " ");

describe("property_financial_setups persistence", () => {
  it("creates an owner-scoped table with select-only client access (writes only through the RPC)", () => {
    expect(sql).toContain("create table if not exists property_financial_setups");
    expect(sql).toContain("alter table property_financial_setups force row level security");
    expect(sql).toContain("unique (owner_id, property_id)");
    expect(sql).toContain("grant select on property_financial_setups to authenticated");
    expect(sql).not.toContain("grant insert on property_financial_setups");
    expect(sql).not.toContain("grant update on property_financial_setups");
  });

  it("does not foreign-key property_id to rental_units, and validates existence in the RPC instead", () => {
    // rental_units has no unique constraint on property_id alone (a property can have multiple
    // units), so a literal foreign key isn't possible -- the RPC checks existence directly.
    expect(sql).not.toContain("references rental_units");
    expect(sql).toContain("this property does not exist in rental manager for this owner");
  });

  it("requires an authenticated owner and a valid, active, owned financial account", () => {
    expect(sql).toContain("authentication is required");
    expect(sql).toContain("setup owner does not match authenticated owner");
    expect(sql).toContain("the selected financial account is invalid");
  });

  it("caps down payment at the purchase price and requires a positive purchase price", () => {
    expect(sql).toContain("down payment must be between 0 and the purchase price");
    expect(sql).toContain("a positive purchase price is required");
    expect(sql).toContain("check (down_payment_cents >= 0 and down_payment_cents <= purchase_price_cents)");
  });

  it("writes the purchase and closing costs as capitalized asset_purchase events, never affecting noi", () => {
    expect(sql).toContain("'asset_purchase', 'real_estate_purchase', false, false, true");
    expect(sql).toContain("'asset_purchase', 'closing_costs', false, false, true");
  });

  it("classifies each transaction line as capital improvement (capitalized) or operating repair (deductible, affects noi)", () => {
    expect(sql).toContain("case when v_capitalized then 'asset_purchase' else 'expense' end");
    expect(sql).toContain("case when v_capitalized then 'capital_improvement' else 'repairs_maintenance' end");
    expect(sql).toContain("not v_capitalized, not v_capitalized, v_capitalized");
  });

  it("derives each line's source_record_id from its own position, not a running counter that shifts with closing costs", () => {
    expect(sql).toContain("ordinality - 1");
    expect(sql).toContain("':line:' || v_index");
  });

  it("replaces prior derived financial_events on every save instead of accumulating duplicates", () => {
    expect(sql).toContain("delete from financial_events");
    expect(sql).toContain("source_system = 'property_financial_setup' and property_id = p_property_id");
  });

  it("upserts the setup row itself (idempotent edits) rather than rejecting a resubmission", () => {
    expect(sql).toContain("on conflict (owner_id, property_id) do update set");
  });

  it("is security definer with row_security off, matching the trusted-write pattern for non-manual financial_events sources", () => {
    expect(sql).toContain("security definer");
    expect(sql).toContain("set row_security = off");
    expect(sql).toContain("grant execute on function save_property_financial_setup");
  });

  it("bounds the number of acquisition/renovation transactions per save", () => {
    expect(sql).toContain("jsonb_array_length(coalesce(p_transactions, '[]'::jsonb)) > 200");
  });
});
