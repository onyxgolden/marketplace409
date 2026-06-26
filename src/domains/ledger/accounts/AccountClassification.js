/**
 * AccountClassification
 *
 * Stable ledger-level account classifications used by future
 * financial intelligence domains.
 *
 * These are not report labels and must not be inferred from account names.
 */
export const AccountClassification = Object.freeze({
  CURRENT_ASSET: "current_asset",
  FIXED_ASSET: "fixed_asset",
  CASH: "cash",
  ACCOUNTS_RECEIVABLE: "accounts_receivable",
  INVENTORY: "inventory",

  CURRENT_LIABILITY: "current_liability",
  LONG_TERM_LIABILITY: "long_term_liability",

  COST_OF_GOODS_SOLD: "cost_of_goods_sold",
  OPERATING_EXPENSE: "operating_expense",
  NON_OPERATING_EXPENSE: "non_operating_expense",

  OPERATING_REVENUE: "operating_revenue",
  OTHER_REVENUE: "other_revenue",
});
