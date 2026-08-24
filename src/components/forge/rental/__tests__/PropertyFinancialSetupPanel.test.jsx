import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PropertyFinancialSetupPanel, { setupToFormState } from "../PropertyFinancialSetupPanel.jsx";

describe("PropertyFinancialSetupPanel", () => {
  it("requires a property before rendering the setup form", () => {
    const markup = renderToStaticMarkup(<PropertyFinancialSetupPanel recordContext={null} />);
    expect(markup).toContain("Select a property before opening financial setup.");
  });

  it("shows a loading state for a given property, using its exact property id (no new property is created)", () => {
    const markup = renderToStaticMarkup(<PropertyFinancialSetupPanel recordContext={{ propertyId: "930 Highland Drive" }} />);
    expect(markup).toContain("Loading financial setup");
  });
});

describe("setupToFormState", () => {
  it("returns blank fields when no setup exists yet", () => {
    const state = setupToFormState(null);
    expect(state).toMatchObject({ financialAccountId: "", purchasePrice: "", loanInterestRatePercent: "" });
  });

  it("converts stored cents back to dollar-denominated form fields", () => {
    const state = setupToFormState({
      financial_account_id: "account_1", purchase_date: "2026-01-15",
      purchase_price_cents: 25000000, down_payment_cents: 5000000, closing_costs_cents: 300000,
      initial_valuation_cents: 25500000, initial_valuation_date: "2026-01-15", lender_name: "First National",
      loan_original_principal_cents: 20000000, loan_origination_date: "2026-01-15",
      loan_current_balance_cents: 19850000, loan_current_balance_as_of: "2026-08-01", loan_interest_rate_bps: 625,
    });
    expect(state).toMatchObject({
      purchasePrice: "250000", downPayment: "50000", closingCosts: "3000",
      initialValuation: "255000", loanOriginalPrincipal: "200000", loanCurrentBalance: "198500",
      loanInterestRatePercent: "6.25",
    });
  });

  it("leaves a null loan interest rate blank rather than rendering '0'", () => {
    const state = setupToFormState({ loan_interest_rate_bps: null });
    expect(state.loanInterestRatePercent).toBe("");
  });
});
