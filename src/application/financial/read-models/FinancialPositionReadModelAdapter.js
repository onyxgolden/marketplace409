function freezeObject(value) {
  return Object.freeze({
    ...value,
  });
}

function freezeItems(items) {
  return Object.freeze(
    items.map((item) => freezeObject(item)),
  );
}

function freezeLines(lines) {
  return Object.freeze(
    lines.map((line) => freezeObject(line)),
  );
}

function sumCashAssets(assets) {
  // "Cash" means liquid, spendable balance — depository accounts (checking/savings), not
  // brokerage/investment holdings. account_type is the account's own type (depository/investment),
  // independent of its provider-supplied subtype, so this holds regardless of which subtype string
  // a given provider (Simplifi import, Plaid once connected, manual entry) happens to report.
  const cashAssets = assets.filter(
    (asset) => asset.account_type === "depository",
  );

  if (cashAssets.length === 0) {
    return null;
  }

  return cashAssets.reduce(
    (total, asset) =>
      total + Number(asset.current_value || 0),
    0,
  );
}

function buildBalanceSheetLines(position) {
  const assetLines = position.assets.map((asset) => ({
    accountId: `asset:${asset.id}`,
    accountName: asset.name,
    amount: Number(asset.current_value || 0),
  }));

  const liabilityLines = position.liabilities.map(
    (liability) => ({
      accountId: `liability:${liability.id}`,
      accountName: liability.name,
      amount: Number(liability.current_balance || 0),
    }),
  );

  return freezeLines([
    ...assetLines,
    ...liabilityLines,
  ]);
}

export class FinancialPositionReadModelAdapter {
  buildPosition(position) {
    if (!position || typeof position !== "object") {
      throw new Error(
        "FinancialPositionReadModelAdapter requires a financial position.",
      );
    }

    if (
      !Array.isArray(position.assets) ||
      !Array.isArray(position.liabilities)
    ) {
      throw new Error(
        "Financial position requires assets and liabilities.",
      );
    }

    if (!position.netWorth) {
      throw new Error(
        "Financial position requires a net worth summary.",
      );
    }

    const cash = sumCashAssets(position.assets);
    const totalAssets = Number(
      position.netWorth.totalAssets || 0,
    );
    const totalLiabilities = Number(
      position.netWorth.totalLiabilities || 0,
    );
    const equity = Number(
      position.netWorth.netWorth || 0,
    );

    // Position KPIs stay in DOLLARS here -- that is the adapter's documented contract
    // (see formatMoney.js on the Financial page). The Workspace tile presenter converts each
    // field according to its own unit; see buildFinancialTilePresentation.js.
    return Object.freeze({
      kpis: freezeObject({
        cash,
        receivables: null,
        debt: totalLiabilities,
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity,
      }),
      // The dashboard merge contract (mergeDashboardProjections) reads these arrays onto the
      // dashboard and the canonical intelligence context; without them the Workspace net worth
      // projection silently computes from empty arrays.
      assets: freezeItems(position.assets),
      liabilities: freezeItems(position.liabilities),
      balanceSheetLines:
        buildBalanceSheetLines(position),
      // Accounts excluded from the aggregates because they have no balance row at all.
      // Surfaced so the UI can disclose the exclusion instead of presenting the total as
      // complete household net worth. Empty (frozen) when every account has a balance.
      missingBalances: freezeItems(
        position.missingBalances ?? [],
      ),
      metadata: freezeObject({
        provider: "financial-position",
        snapshotStatus: "repository-backed",
        phase: "16.3",
        balanceSheetStatus:
          "repository-backed-financial-accounts",
        accountBalancesStatus:
          position.metadata?.accountBalancesStatus ??
          "unavailable",
        receivablesStatus:
          "unavailable-without-receivables-source",
        metricsStatus:
          position.metadata?.metricsStatus ??
          "unavailable",
        insightsStatus:
          position.metadata?.insightsStatus ??
          "unavailable",
      }),
    });
  }
}

export const financialPositionReadModelAdapter =
  new FinancialPositionReadModelAdapter();

Object.freeze(FinancialPositionReadModelAdapter);
