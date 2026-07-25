function freezeObject(value) {
  return Object.freeze({
    ...value,
  });
}

function freezeLines(lines) {
  return Object.freeze(
    lines.map((line) => freezeObject(line)),
  );
}

function sumCashAssets(assets) {
  const cashAssets = assets.filter(
    (asset) => asset.category === "cash",
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

    return Object.freeze({
      kpis: freezeObject({
        cash,
        receivables: null,
        debt: totalLiabilities,
        assets: totalAssets,
        liabilities: totalLiabilities,
        equity,
      }),
      balanceSheetLines:
        buildBalanceSheetLines(position),
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
