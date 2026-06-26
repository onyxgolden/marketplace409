import { AccountClassification } from "../accounts";

/**
 * ClassificationTaxonomy
 *
 * Immutable ledger-level semantic taxonomy for account classifications.
 *
 * AccountClassification defines the vocabulary.
 * ClassificationTaxonomy defines accounting meaning.
 *
 * Future domains should consume this taxonomy rather than implementing
 * accounting semantics independently.
 */
export class ClassificationTaxonomy {
  constructor() {
    this.currentAssets = new Set([
      AccountClassification.CURRENT_ASSET,
      AccountClassification.CASH,
      AccountClassification.ACCOUNTS_RECEIVABLE,
      AccountClassification.INVENTORY,
    ]);

    this.liquidAssets = new Set([
      AccountClassification.CASH,
      AccountClassification.ACCOUNTS_RECEIVABLE,
    ]);

    this.currentLiabilities = new Set([
      AccountClassification.CURRENT_LIABILITY,
    ]);

    this.operatingRevenue = new Set([
      AccountClassification.OPERATING_REVENUE,
    ]);

    this.costOfGoodsSold = new Set([
      AccountClassification.COST_OF_GOODS_SOLD,
    ]);

    this.operatingExpenses = new Set([
      AccountClassification.OPERATING_EXPENSE,
    ]);

    this.currentRatioParticipants = new Set([
      ...this.currentAssets,
      ...this.currentLiabilities,
    ]);

    this.quickRatioParticipants = new Set([
      ...this.liquidAssets,
      ...this.currentLiabilities,
    ]);

    this.grossProfitParticipants = new Set([
      ...this.operatingRevenue,
      ...this.costOfGoodsSold,
    ]);

    Object.freeze(this);
  }

  isCurrentAsset(classification) {
    return this.currentAssets.has(classification);
  }

  isLiquidAsset(classification) {
    return this.liquidAssets.has(classification);
  }

  isCurrentLiability(classification) {
    return this.currentLiabilities.has(classification);
  }

  isOperatingRevenue(classification) {
    return this.operatingRevenue.has(classification);
  }

  isCostOfGoodsSold(classification) {
    return this.costOfGoodsSold.has(classification);
  }

  isOperatingExpense(classification) {
    return this.operatingExpenses.has(classification);
  }

  participatesInCurrentRatio(classification) {
    return this.currentRatioParticipants.has(classification);
  }

  participatesInQuickRatio(classification) {
    return this.quickRatioParticipants.has(classification);
  }

  participatesInGrossProfit(classification) {
    return this.grossProfitParticipants.has(classification);
  }
}
