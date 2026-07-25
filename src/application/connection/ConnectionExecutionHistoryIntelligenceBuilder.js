function freeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item) => freeze(item)),
    );
  }

  if (
    value !== null &&
    typeof value === "object"
  ) {
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

function metric(record, key) {
  const value =
    record?.metrics?.[key];

  return (
    typeof value === "number" &&
    Number.isFinite(value)
  )
    ? value
    : 0;
}

function timestamp(record) {
  return Date.parse(
    record.completedAt ||
      record.createdAt ||
      record.startedAt ||
      "",
  );
}

function newestFirst(history) {
  return history
    .slice()
    .sort((left, right) => {
      const timestampDifference =
        timestamp(right) -
        timestamp(left);

      if (
        Number.isFinite(timestampDifference) &&
        timestampDifference !== 0
      ) {
        return timestampDifference;
      }

      return String(right.id || "")
        .localeCompare(
          String(left.id || ""),
        );
    });
}

function rate(count, total) {
  if (total === 0) {
    return 0;
  }

  return Number(
    (count / total).toFixed(4),
  );
}

export class ConnectionExecutionHistoryIntelligenceBuilder {
  static build(executionHistory = []) {
    const history =
      Array.isArray(executionHistory)
        ? newestFirst(executionHistory)
        : [];

    const totalExecutions =
      history.length;

    const successfulExecutions =
      history.filter(
        (record) =>
          record.status === "success",
      ).length;

    const failedExecutions =
      history.filter(
        (record) =>
          record.status === "failed",
      ).length;

    const completedExecutions =
      history.filter(
        (record) =>
          record.status === "completed",
      ).length;

    const consecutiveFailures =
      history.findIndex(
        (record) =>
          record.status !== "failed",
      );

    const lastSuccessfulExecution =
      history.find(
        (record) =>
          record.status === "success",
      ) || null;

    const lastFailedExecution =
      history.find(
        (record) =>
          record.status === "failed",
      ) || null;

    const importedTotals =
      history.reduce(
        (totals, record) => ({
          financialAccounts:
            totals.financialAccounts +
            metric(
              record,
              "financialAccountsImported",
            ),
          accountBalances:
            totals.accountBalances +
            metric(
              record,
              "accountBalancesImported",
            ),
          transactions:
            totals.transactions +
            metric(
              record,
              "transactionsImported",
            ),
          failedRecords:
            totals.failedRecords +
            metric(
              record,
              "failedRecordCount",
            ),
        }),
        {
          financialAccounts: 0,
          accountBalances: 0,
          transactions: 0,
          failedRecords: 0,
        },
      );

    return freeze({
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      completedExecutions,

      successRate:
        rate(
          successfulExecutions,
          totalExecutions,
        ),

      failureRate:
        rate(
          failedExecutions,
          totalExecutions,
        ),

      completionRate:
        rate(
          completedExecutions,
          totalExecutions,
        ),

      consecutiveFailures:
        consecutiveFailures === -1
          ? totalExecutions
          : consecutiveFailures,

      lastExecution:
        history[0] || null,

      lastSuccessfulExecution,
      lastFailedExecution,
      importedTotals,
    });
  }
}

Object.freeze(
  ConnectionExecutionHistoryIntelligenceBuilder,
);
