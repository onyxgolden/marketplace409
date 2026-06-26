import { describe, expect, test } from "vitest";
import { AccountClassification } from "../../accounts";
import {
  ClassificationSemanticGroup,
  ClassificationTaxonomy,
} from "../index";

describe("ClassificationTaxonomy", () => {
  test("creates an immutable taxonomy", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(Object.isFrozen(taxonomy)).toBe(true);
  });

  test("identifies semantic membership generically", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(
      taxonomy.hasMembership(
        AccountClassification.CASH,
        ClassificationSemanticGroup.CURRENT_ASSET,
      ),
    ).toBe(true);

    expect(
      taxonomy.hasMembership(
        AccountClassification.CASH,
        ClassificationSemanticGroup.LIQUID_ASSET,
      ),
    ).toBe(true);

    expect(
      taxonomy.hasMembership(
        AccountClassification.INVENTORY,
        ClassificationSemanticGroup.LIQUID_ASSET,
      ),
    ).toBe(false);

    expect(
      taxonomy.hasMembership(
        AccountClassification.CURRENT_LIABILITY,
        ClassificationSemanticGroup.CURRENT_RATIO,
      ),
    ).toBe(true);

    expect(
      taxonomy.hasMembership(
        AccountClassification.FIXED_ASSET,
        ClassificationSemanticGroup.CURRENT_RATIO,
      ),
    ).toBe(false);
  });

  test("identifies current assets", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(taxonomy.isCurrentAsset(AccountClassification.CURRENT_ASSET)).toBe(true);
    expect(taxonomy.isCurrentAsset(AccountClassification.CASH)).toBe(true);
    expect(taxonomy.isCurrentAsset(AccountClassification.ACCOUNTS_RECEIVABLE)).toBe(true);
    expect(taxonomy.isCurrentAsset(AccountClassification.INVENTORY)).toBe(true);
    expect(taxonomy.isCurrentAsset(AccountClassification.FIXED_ASSET)).toBe(false);
  });

  test("identifies liquid assets", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(taxonomy.isLiquidAsset(AccountClassification.CASH)).toBe(true);
    expect(taxonomy.isLiquidAsset(AccountClassification.ACCOUNTS_RECEIVABLE)).toBe(true);
    expect(taxonomy.isLiquidAsset(AccountClassification.INVENTORY)).toBe(false);
    expect(taxonomy.isLiquidAsset(AccountClassification.FIXED_ASSET)).toBe(false);
  });

  test("identifies current liabilities", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(taxonomy.isCurrentLiability(AccountClassification.CURRENT_LIABILITY)).toBe(true);
    expect(taxonomy.isCurrentLiability(AccountClassification.LONG_TERM_LIABILITY)).toBe(false);
  });

  test("identifies income statement semantic groups", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(taxonomy.isOperatingRevenue(AccountClassification.OPERATING_REVENUE)).toBe(true);
    expect(taxonomy.isOperatingRevenue(AccountClassification.OTHER_REVENUE)).toBe(false);

    expect(taxonomy.isCostOfGoodsSold(AccountClassification.COST_OF_GOODS_SOLD)).toBe(true);
    expect(taxonomy.isCostOfGoodsSold(AccountClassification.OPERATING_EXPENSE)).toBe(false);

    expect(taxonomy.isOperatingExpense(AccountClassification.OPERATING_EXPENSE)).toBe(true);
    expect(taxonomy.isOperatingExpense(AccountClassification.NON_OPERATING_EXPENSE)).toBe(false);
  });

  test("identifies current ratio participants", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(taxonomy.participatesInCurrentRatio(AccountClassification.CASH)).toBe(true);
    expect(taxonomy.participatesInCurrentRatio(AccountClassification.INVENTORY)).toBe(true);
    expect(taxonomy.participatesInCurrentRatio(AccountClassification.CURRENT_LIABILITY)).toBe(true);
    expect(taxonomy.participatesInCurrentRatio(AccountClassification.FIXED_ASSET)).toBe(false);
  });

  test("identifies quick ratio participants", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(taxonomy.participatesInQuickRatio(AccountClassification.CASH)).toBe(true);
    expect(taxonomy.participatesInQuickRatio(AccountClassification.ACCOUNTS_RECEIVABLE)).toBe(true);
    expect(taxonomy.participatesInQuickRatio(AccountClassification.INVENTORY)).toBe(false);
    expect(taxonomy.participatesInQuickRatio(AccountClassification.CURRENT_LIABILITY)).toBe(true);
  });

  test("identifies gross profit participants", () => {
    const taxonomy = new ClassificationTaxonomy();

    expect(taxonomy.participatesInGrossProfit(AccountClassification.OPERATING_REVENUE)).toBe(true);
    expect(taxonomy.participatesInGrossProfit(AccountClassification.COST_OF_GOODS_SOLD)).toBe(true);
    expect(taxonomy.participatesInGrossProfit(AccountClassification.OPERATING_EXPENSE)).toBe(false);
  });
});
