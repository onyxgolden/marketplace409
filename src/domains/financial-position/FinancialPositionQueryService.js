import { NetWorthService } from "../networth/networth.service";

export const ASSET_ACCOUNT_TYPES = Object.freeze(
  new Set(["depository", "investment", "other"]),
);

export const LIABILITY_ACCOUNT_TYPES = Object.freeze(
  new Set(["credit", "loan"]),
);

function freezeItems(items) {
  return Object.freeze(
    items.map((item) => Object.freeze({ ...item })),
  );
}

function centsToDollars(cents) {
  return Number(cents) / 100;
}

function buildBalanceByAccountId(accountBalances) {
  return new Map(
    accountBalances.map((balance) => [
      balance.financialAccountId,
      balance,
    ]),
  );
}

function projectAssets(financialAccounts, balanceByAccountId) {
  return financialAccounts
    .filter((account) => account.active !== false && ASSET_ACCOUNT_TYPES.has(account.type))
    .flatMap((account) => {
      const balance = balanceByAccountId.get(account.id);

      if (!balance) {
        return [];
      }

      return [{
        id: account.id,
        name: account.name,
        category: account.subtype || account.type,
        account_type: account.type,
        current_value: centsToDollars(
          balance.currentBalanceCents,
        ),
      }];
    });
}

function projectLiabilities(
  financialAccounts,
  balanceByAccountId,
) {
  return financialAccounts
    .filter((account) =>
      account.active !== false && LIABILITY_ACCOUNT_TYPES.has(account.type),
    )
    .flatMap((account) => {
      const balance = balanceByAccountId.get(account.id);

      if (!balance) {
        return [];
      }

      return [{
        id: account.id,
        name: account.name,
        category: account.subtype || account.type,
        current_balance: centsToDollars(
          balance.currentBalanceCents,
        ),
      }];
    });
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
    financialAccountRepository,
    accountBalanceRepository,
    netWorthService = NetWorthService,
  } = {}) {
    if (
      !financialAccountRepository ||
      typeof financialAccountRepository.findByOwnerId !==
        "function"
    ) {
      throw new Error(
        "FinancialPositionQueryService requires a financial account repository.",
      );
    }

    if (
      !accountBalanceRepository ||
      typeof accountBalanceRepository.findLatestByOwnerId !==
        "function"
    ) {
      throw new Error(
        "FinancialPositionQueryService requires an account balance repository.",
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

    this.financialAccountRepository =
      financialAccountRepository;
    this.accountBalanceRepository =
      accountBalanceRepository;
    this.netWorthService = netWorthService;

    Object.freeze(this);
  }

  async buildPosition(ownerId) {
    if (!ownerId) {
      throw new Error(
        "FinancialPositionQueryService requires an owner id.",
      );
    }

    const [financialAccounts, accountBalances] =
      await Promise.all([
        this.financialAccountRepository.findByOwnerId(
          ownerId,
        ),
        this.accountBalanceRepository.findLatestByOwnerId(
          ownerId,
        ),
      ]);

    const immutableAccountBalances =
      freezeItems(accountBalances);

    const balanceByAccountId =
      buildBalanceByAccountId(
        immutableAccountBalances,
      );

    const immutableAssets = freezeItems(
      projectAssets(
        financialAccounts,
        balanceByAccountId,
      ),
    );

    const immutableLiabilities = freezeItems(
      projectLiabilities(
        financialAccounts,
        balanceByAccountId,
      ),
    );

    const netWorth = Object.freeze(
      this.netWorthService.calculate(
        mapAssetsForNetWorth(immutableAssets),
        mapLiabilitiesForNetWorth(
          immutableLiabilities,
        ),
      ),
    );

    return Object.freeze({
      assets: immutableAssets,
      liabilities: immutableLiabilities,
      accountBalances: immutableAccountBalances,
      netWorth,
      metrics: null,
      insights: Object.freeze([]),
      metadata: Object.freeze({
        accountBalancesStatus: "repository-backed",
        metricsStatus:
          "unavailable-without-canonical-ledger-position",
        insightsStatus:
          "unavailable-without-financial-metrics",
      }),
    });
  }
}

Object.freeze(FinancialPositionQueryService);
