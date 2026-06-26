import { AccountClassification } from "../accounts";
import { ClassificationSemanticGroup } from "./ClassificationSemanticGroup";

/**
 * ClassificationTaxonomy
 *
 * Immutable ledger-level semantic taxonomy for account classifications.
 *
 * AccountClassification defines the vocabulary.
 * ClassificationSemanticGroup defines semantic membership.
 * ClassificationTaxonomy defines accounting meaning.
 *
 * Future domains should consume this taxonomy rather than implementing
 * accounting semantics independently.
 */
export class ClassificationTaxonomy {
  constructor() {
    this.memberships = new Map([
      [
        AccountClassification.CURRENT_ASSET,
        new Set([
          ClassificationSemanticGroup.CURRENT_ASSET,
          ClassificationSemanticGroup.CURRENT_RATIO,
        ]),
      ],
      [
        AccountClassification.CASH,
        new Set([
          ClassificationSemanticGroup.CURRENT_ASSET,
          ClassificationSemanticGroup.LIQUID_ASSET,
          ClassificationSemanticGroup.CURRENT_RATIO,
          ClassificationSemanticGroup.QUICK_RATIO,
        ]),
      ],
      [
        AccountClassification.ACCOUNTS_RECEIVABLE,
        new Set([
          ClassificationSemanticGroup.CURRENT_ASSET,
          ClassificationSemanticGroup.LIQUID_ASSET,
          ClassificationSemanticGroup.CURRENT_RATIO,
          ClassificationSemanticGroup.QUICK_RATIO,
        ]),
      ],
      [
        AccountClassification.INVENTORY,
        new Set([
          ClassificationSemanticGroup.CURRENT_ASSET,
          ClassificationSemanticGroup.CURRENT_RATIO,
        ]),
      ],
      [
        AccountClassification.CURRENT_LIABILITY,
        new Set([
          ClassificationSemanticGroup.CURRENT_LIABILITY,
          ClassificationSemanticGroup.CURRENT_RATIO,
          ClassificationSemanticGroup.QUICK_RATIO,
        ]),
      ],
      [
        AccountClassification.OPERATING_REVENUE,
        new Set([
          ClassificationSemanticGroup.OPERATING_REVENUE,
          ClassificationSemanticGroup.GROSS_PROFIT,
        ]),
      ],
      [
        AccountClassification.COST_OF_GOODS_SOLD,
        new Set([
          ClassificationSemanticGroup.COST_OF_GOODS_SOLD,
          ClassificationSemanticGroup.GROSS_PROFIT,
        ]),
      ],
      [
        AccountClassification.OPERATING_EXPENSE,
        new Set([
          ClassificationSemanticGroup.OPERATING_EXPENSE,
        ]),
      ],
    ]);

    for (const groups of this.memberships.values()) {
      Object.freeze(groups);
    }

    Object.freeze(this);
  }

  hasMembership(classification, semanticGroup) {
    return this.memberships.get(classification)?.has(semanticGroup) ?? false;
  }

  isCurrentAsset(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.CURRENT_ASSET,
    );
  }

  isLiquidAsset(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.LIQUID_ASSET,
    );
  }

  isCurrentLiability(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.CURRENT_LIABILITY,
    );
  }

  isOperatingRevenue(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.OPERATING_REVENUE,
    );
  }

  isCostOfGoodsSold(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.COST_OF_GOODS_SOLD,
    );
  }

  isOperatingExpense(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.OPERATING_EXPENSE,
    );
  }

  participatesInCurrentRatio(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.CURRENT_RATIO,
    );
  }

  participatesInQuickRatio(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.QUICK_RATIO,
    );
  }

  participatesInGrossProfit(classification) {
    return this.hasMembership(
      classification,
      ClassificationSemanticGroup.GROSS_PROFIT,
    );
  }
}
