import { NetWorthService } from "../networth/networth.service";

function freezeItems(items) {
  return Object.freeze(
    items.map((item) => Object.freeze({ ...item })),
  );
}

function mapAssetsForNetWorth(assets) {
  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    category: asset.category,
    value: Number(asset.current_value),
  }));
}

function mapLiabilitiesForNetWorth(liabilities) {
  return liabilities.map((liability) => ({
    id: liability.id,
    name: liability.name,
    category: liability.category,
    balance: Number(liability.current_balance),
  }));
}

export class FinancialPositionQueryService {
  constructor({
    assetRepository,
    liabilityRepository,
    netWorthService = NetWorthService,
  } = {}) {
    if (
      !assetRepository ||
      typeof assetRepository.getAll !== "function"
    ) {
      throw new Error(
        "FinancialPositionQueryService requires an asset repository.",
      );
    }

    if (
      !liabilityRepository ||
      typeof liabilityRepository.getAll !== "function"
    ) {
      throw new Error(
        "FinancialPositionQueryService requires a liability repository.",
      );
    }

    if (
      !netWorthService ||
      typeof netWorthService.calculate !== "function"
    ) {
      throw new Error(
        "FinancialPositionQueryService requires a net worth service.",
      );
    }

    this.assetRepository = assetRepository;
    this.liabilityRepository = liabilityRepository;
    this.netWorthService = netWorthService;

    Object.freeze(this);
  }

  async buildPosition() {
    const [assets, liabilities] = await Promise.all([
      this.assetRepository.getAll(),
      this.liabilityRepository.getAll(),
    ]);

    const immutableAssets = freezeItems(assets);
    const immutableLiabilities = freezeItems(liabilities);

    const netWorth = Object.freeze(
      this.netWorthService.calculate(
        mapAssetsForNetWorth(immutableAssets),
        mapLiabilitiesForNetWorth(immutableLiabilities),
      ),
    );

    return Object.freeze({
      assets: immutableAssets,
      liabilities: immutableLiabilities,
      accountBalances: Object.freeze([]),
      netWorth,
      metrics: null,
      insights: Object.freeze([]),
      metadata: Object.freeze({
        accountBalancesStatus:
          "unavailable-without-owner-wide-balance-query",
        metricsStatus:
          "unavailable-without-canonical-ledger-position",
        insightsStatus:
          "unavailable-without-financial-metrics",
      }),
    });
  }
}

Object.freeze(FinancialPositionQueryService);
