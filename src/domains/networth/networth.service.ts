import type {
  NetWorthAsset,
  NetWorthLiability,
  NetWorthSummary,
} from "./networth.types";

export class NetWorthService {
  static calculate(
    assets: NetWorthAsset[],
    liabilities: NetWorthLiability[]
  ): NetWorthSummary {
    const totalAssets = assets.reduce((sum, asset) => sum + asset.value, 0);

    // A liability balance is a debt owed no matter which sign the provider stored it with.
    // Stripe Financial Connections imported one owner's mortgage as a negative balance
    // (-175,158.18); subtracting that raw value would ADD the debt to net worth instead of
    // reducing it, so normalize to the absolute amount owed. This changes no stored data --
    // it only corrects the calculation.
    const totalLiabilities = liabilities.reduce(
      (sum, liability) => sum + Math.abs(liability.balance),
      0
    );

    return {
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
      debtToAssetRatio:
        totalAssets > 0 ? totalLiabilities / totalAssets : 0,
    };
  }
}
