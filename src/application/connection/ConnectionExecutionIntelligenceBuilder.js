function freeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => freeze(item)),
    );
  }

  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(
          ([key, entryValue]) => [
            key,
            freeze(entryValue),
          ],
        ),
      ),
    );
  }

  return value;
}

export class ConnectionExecutionIntelligenceBuilder {
  static build(executionResult = {}) {
    const success =
      executionResult.success === true;

    const failedRecordCount =
      executionResult.failedRecordCount || 0;

    const transactionsImported =
      executionResult.transactionsImported || 0;

    const financialAccountsImported =
      executionResult.financialAccountsImported || 0;

    const accountBalancesImported =
      executionResult.accountBalancesImported || 0;

    const status =
      success
        ? "successful"
        : "failed";

    const health =
      success
        ? {
            state: "healthy",
            score: 100,
          }
        : {
            state: "needs_attention",
            score: 0,
          };

    const recommendation =
      success
        ? {
            action: "none",
            priority: "normal",
          }
        : {
            action: "review-connection",
            priority:
              failedRecordCount > 0
                ? "high"
                : "medium",
          };

    return freeze({
      status,
      success,
      occurredAt:
        executionResult.occurredAt || null,

      provider:
        executionResult.provider || null,

      connectionId:
        executionResult.connectionId || null,

      metrics: {
        financialAccountsImported,
        accountBalancesImported,
        transactionsImported,
        failedRecordCount,
      },

      health,

      recommendation,
    });
  }
}

Object.freeze(
  ConnectionExecutionIntelligenceBuilder,
);
