import { NextResponse } from "next/server";

import { createAuthenticatedFinancialApplication } from "@/lib/supabase/createAuthenticatedFinancialApplication";
import {
  DEBT_PAYOFF_SUGGESTIONS_PREFERENCE,
  compareDebtPayoffStrategies,
} from "@/domains/ledger/brain/debtPayoff.js";

// Debt account types: 'credit' covers loans/HELOCs/credit lines (see the
// reconcile-transfers route), 'loan' is the other creatable debt type.
const DEBT_ACCOUNT_TYPES = new Set(["credit", "loan"]);

// Read-only debt-payoff comparison. Assembles the owner's debt accounts
// (balances from the liability feed, APR/minimums from owner-confirmed debt
// terms) and returns the avalanche vs snowball vs minimums-only comparison.
// Debts without confirmed terms are listed as needsTerms and excluded from
// the simulation -- rates are never guessed.
//
// The proactive "top move" is suppressed entirely when the owner's
// debt_payoff_suggestions_enabled preference is off, so every consumer
// (panel, digest, inbox) stays silent by construction.
export async function GET(request) {
  const authenticated = await createAuthenticatedFinancialApplication();
  if (authenticated.response) return authenticated.response;

  const params = new URL(request.url).searchParams;
  const surplusParam = params.get("monthlySurplus");
  const monthlySurplus = surplusParam == null ? 0 : Number(surplusParam);
  if (!Number.isFinite(monthlySurplus) || monthlySurplus < 0) {
    return NextResponse.json(
      { error: "monthlySurplus must be a non-negative number." },
      { status: 400 },
    );
  }
  const taxRateParam = params.get("taxRate");
  const marginalTaxRate = taxRateParam == null ? 0 : Number(taxRateParam);
  if (!Number.isFinite(marginalTaxRate) || marginalTaxRate < 0 || marginalTaxRate >= 1) {
    return NextResponse.json(
      { error: "taxRate must be a number between 0 (inclusive) and 1 (exclusive)." },
      { status: 400 },
    );
  }

  try {
    const suite = await authenticated.getFinancialApplicationSuite();
    const [accounts, balances, termsByAccountId, suggestionsEnabled] = await Promise.all([
      suite.financialAccountRepository.findByOwnerId(authenticated.user.id),
      suite.accountBalanceRepository.findLatestByOwnerId(authenticated.user.id),
      fetchDebtTerms(authenticated.supabaseClient, authenticated.effectiveOwnerId),
      fetchSuggestionsEnabled(authenticated.supabaseClient, authenticated.effectiveOwnerId),
    ]);

    const balanceByAccountId = new Map(
      (balances ?? []).map((balance) => [balance.financialAccountId, balance]),
    );

    const debts = [];
    for (const account of accounts ?? []) {
      if (account?.active === false) continue;
      if (!DEBT_ACCOUNT_TYPES.has(account?.type)) continue;
      const balance = balanceByAccountId.get(account.id);
      // currentBalanceCents is human-signed: liabilities arrive negative, so
      // the owed magnitude is what the optimizer needs.
      const owedDollars = Math.abs(Number(balance?.currentBalanceCents) || 0) / 100;
      if (!(owedDollars > 0)) continue;
      const terms = termsByAccountId.get(account.id);
      debts.push({
        id: account.id,
        name: account.name ?? account.id,
        balance: Math.round(owedDollars * 100) / 100,
        apr: terms?.apr ?? null,
        minimumPayment: terms?.minimumPayment ?? null,
        taxDeductible: terms?.taxDeductible ?? false,
      });
    }

    const comparison = compareDebtPayoffStrategies({ debts, monthlySurplus, marginalTaxRate });
    const { avalanche } = comparison.strategies;

    return NextResponse.json({
      success: true,
      data: {
        eligible: avalanche.eligible,
        needsTerms: avalanche.needsTerms,
        strategies: {
          avalanche: stripEligible(comparison.strategies.avalanche),
          snowball: stripEligible(comparison.strategies.snowball),
          minimums: stripEligible(comparison.strategies.minimums),
        },
        interestSavedVsMinimums: comparison.interestSavedVsMinimums,
        topMove: suggestionsEnabled ? comparison.topMove : null,
        suggestionsEnabled,
        monthlySurplus: avalanche.monthlySurplus,
        marginalTaxRate: avalanche.marginalTaxRate,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not build the debt-payoff comparison." },
      { status: 500 },
    );
  }
}

// The per-strategy eligible lists are identical; send one copy.
function stripEligible(plan) {
  const { eligible: _eligible, ...rest } = plan;
  return rest;
}

// Graceful when the migration hasn't been deployed yet: debts simply show as
// needing terms, never a 500.
async function fetchDebtTerms(supabaseClient, ownerId) {
  try {
    const { data, error } = await supabaseClient
      .from("debt_terms")
      .select("financial_account_id, apr, minimum_payment, tax_deductible")
      .eq("owner_id", ownerId);
    if (error) throw error;
    return new Map(
      (data ?? []).map((row) => [
        row.financial_account_id,
        {
          apr: row.apr == null ? null : Number(row.apr),
          minimumPayment: row.minimum_payment == null ? null : Number(row.minimum_payment),
          taxDeductible: row.tax_deductible === true,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

// Absence of a preference row means the default: ON.
async function fetchSuggestionsEnabled(supabaseClient, ownerId) {
  try {
    const { data, error } = await supabaseClient
      .from("brain_preferences")
      .select("enabled")
      .eq("owner_id", ownerId)
      .eq("preference_key", DEBT_PAYOFF_SUGGESTIONS_PREFERENCE)
      .maybeSingle();
    if (error) throw error;
    if (!data) return true;
    return data.enabled !== false;
  } catch {
    return true;
  }
}
