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

    const totalLiabilities = liabilities.reduce(
      (sum, liability) => sum + liability.balance,
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
