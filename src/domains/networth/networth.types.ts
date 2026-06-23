export type NetWorthAsset = {
  id: string;
  name: string;
  category: string;
  value: number;
};

export type NetWorthLiability = {
  id: string;
  name: string;
  category: string;
  balance: number;
};

export type NetWorthSummary = {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;

  /**
   * Total liabilities divided by total assets.
   * Returns a value from 0–1 when assets are greater than zero.
   * Returns 0 when there are no assets.
   */
  debtToAssetRatio: number;
};
