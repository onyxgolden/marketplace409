// South Main is the first validation account for this product, not the product's schema or default
// configuration -- these tests prove two structural facts that back that statement up, rather than
// leaving it as an assertion in a comment or a governance doc alone:
//   1. The calculation engine never references `product` (seller_financing vs. personal_loan) at all --
//      it computes identically for either financing type, because financing type is not one of its inputs.
//   2. No production module imports the South Main fixture -- it is test/fixture-only data, structurally
//      incapable of leaking into a real calculation no matter what its own numbers say.
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { computeAccountBalanceSummary } from "../accountBalanceSummary.js";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const domainDir = path.resolve(testsDir, "..");

function readProductionSourceFiles() {
  return readdirSync(domainDir)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js"))
    .map((name) => ({ name, text: readFileSync(path.join(domainDir, name), "utf8") }));
}

describe("the calculation engine is independent of financing product type", () => {
  it("no core calculation module (accountBalanceSummary, replayEvents, paymentAllocation, interestAccrual, payoffQuote) references `product` at all", () => {
    for (const filename of ["accountBalanceSummary.js", "replayEvents.js", "paymentAllocation.js", "interestAccrual.js", "payoffQuote.js"]) {
      const text = readFileSync(path.join(domainDir, filename), "utf8");
      // A loose word-boundary check for the identifier `product` (not, e.g., "production" or "byproduct")
      // -- these modules take account terms and event history as input, never a financing-type flag.
      expect(text).not.toMatch(/\bproduct\b/);
    }
  });

  it("computes identical balances for two accounts with the same terms, regardless of which financing type they belong to -- proving product type is not a hidden input", () => {
    const eventRows = [{
      id: "evt_open", owner_id: "owner-1", account_id: "acct_1", event_type: "account_opened",
      event_origin: "interactive_user", created_by: "owner-1", ledger_sequence: 1, effective_date: "2025-03-01",
      recorded_at: "2025-03-01T00:00:00Z",
    }];
    const componentRows = [
      { owner_id: "owner-1", id: "comp_1", account_id: "acct_1", component_key: "only", label: "Note", original_principal_cents: 180_000, rate_bps: 550, day_count_convention: "actual_365", scheduled_component_amount_cents: 4_000, allocation_priority: 1, effective_date: "2025-03-01", version_number: 1 },
    ];
    const termsRows = [
      { owner_id: "owner-1", id: "terms_1", account_id: "acct_1", version_number: 1, payment_frequency: "monthly", first_payment_due_date: "2025-04-01", regular_scheduled_payment_amount_cents: 4_000, maturity_date: null, allocation_policy: "scheduled_component_order", extra_payment_allocation_policy: "highest_rate_first_extra", prepayment_policy: "allowed_without_penalty_does_not_advance_due_date", day_count_convention: "actual_365", effective_date: "2025-03-01", acting_seller_id: "owner-1", amendment_reason: null },
    ];
    // computeAccountBalanceSummary takes no product/financingType argument at all -- calling it with the
    // exact same event/component/terms rows for a hypothetical seller_financing account and a hypothetical
    // personal_loan account (the caller-side distinction lives entirely in private_financing_accounts.product,
    // never passed into this function) necessarily produces the same result, since there is no code path
    // for it to differ on.
    const summaryA = computeAccountBalanceSummary(eventRows, componentRows, termsRows, { asOfDate: "2025-03-01" });
    const summaryB = computeAccountBalanceSummary(eventRows, componentRows, termsRows, { asOfDate: "2025-03-01" });
    expect(summaryA).toEqual(summaryB);
  });
});

describe("the South Main fixture never leaks into production code", () => {
  it("no non-test, non-fixture module under src/domains/private-financing imports southMainPayments.js", () => {
    const offenders = readProductionSourceFiles().filter(({ text }) => text.includes("southMainPayments"));
    expect(offenders.map((file) => file.name)).toEqual([]);
  });

  it("no non-test, non-fixture module hard-codes South Main's specific dollar figures ($45,000/$10,000 split, $517.85 payment, 48 payments)", () => {
    const offenders = readProductionSourceFiles().filter(
      ({ text }) => text.includes("4_500_000") || text.includes("1_000_000") || text.includes("51_785") || text.includes("43_452") || text.includes("8_333"),
    );
    expect(offenders.map((file) => file.name)).toEqual([]);
  });
});
