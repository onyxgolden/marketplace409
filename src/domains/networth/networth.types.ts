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
};