/**
 * ClassificationSemanticGroup
 *
 * Stable ledger-level semantic groups used by ClassificationTaxonomy.
 *
 * AccountClassification defines what an account is.
 * ClassificationSemanticGroup defines what semantic groups it belongs to.
 *
 * Future domains should query taxonomy membership instead of relying on
 * hard-coded taxonomy methods.
 */
export const ClassificationSemanticGroup = Object.freeze({
  CURRENT_ASSET: "current_asset",
  LIQUID_ASSET: "liquid_asset",
  CURRENT_LIABILITY: "current_liability",

  OPERATING_REVENUE: "operating_revenue",
  COST_OF_GOODS_SOLD: "cost_of_goods_sold",
  OPERATING_EXPENSE: "operating_expense",

  CURRENT_RATIO: "current_ratio",
  QUICK_RATIO: "quick_ratio",
  GROSS_PROFIT: "gross_profit",
});
