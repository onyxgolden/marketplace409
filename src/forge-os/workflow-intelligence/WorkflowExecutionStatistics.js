function getRecords(source) {
  if (Array.isArray(source)) {
    return source;
  }

  if (
    source &&
    typeof source.list === "function"
  ) {
    return source.list();
  }

  throw new Error(
    "WorkflowExecutionStatistics requires execution records or a registry.",
  );
}

function calculateDurationMilliseconds(record) {
  const startedAt =
    Date.parse(record.startedAt);

  const completedAt =
    Date.parse(record.completedAt);

  if (
    Number.isNaN(startedAt) ||
    Number.isNaN(completedAt)
  ) {
    return null;
  }

  return Math.max(
    0,
    completedAt - startedAt,
  );
}

export class WorkflowExecutionStatistics {
  analyze(source) {
    const records =
      getRecords(source);

    const totalExecutions =
      records.length;

    const successfulExecutions =
      records.filter(
        (record) =>
          record.completionStatus ===
          "completed",
      ).length;

    const failedExecutions =
      records.filter(
        (record) =>
          record.completionStatus ===
          "failed",
      ).length;

    const interruptedExecutions =
      records.filter(
        (record) =>
          record.completionStatus ===
          "interrupted",
      ).length;

    const totalCompletedSteps =
      records.reduce(
        (total, record) =>
          total +
          record.completedSteps.length,
        0,
      );

    const totalOutcomeContracts =
      records.reduce(
        (total, record) =>
          total +
          record.outcomeContractIds
            .length,
        0,
      );

    const durations =
      records
        .map(
          calculateDurationMilliseconds,
        )
        .filter(
          (duration) =>
            duration !== null,
        );

    const totalDurationMilliseconds =
      durations.reduce(
        (total, duration) =>
          total + duration,
        0,
      );

    const completionRate =
      totalExecutions === 0
        ? 0
        : successfulExecutions /
          totalExecutions;

    const failureRate =
      totalExecutions === 0
        ? 0
        : failedExecutions /
          totalExecutions;

    const averageCompletedSteps =
      totalExecutions === 0
        ? 0
        : totalCompletedSteps /
          totalExecutions;

    const averageOutcomeContracts =
      totalExecutions === 0
        ? 0
        : totalOutcomeContracts /
          totalExecutions;

    const averageDurationMilliseconds =
      durations.length === 0
        ? 0
        : totalDurationMilliseconds /
          durations.length;

    return Object.freeze({
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      interruptedExecutions,
      completionRate,
      failureRate,
      totalCompletedSteps,
      averageCompletedSteps,
      totalOutcomeContracts,
      averageOutcomeContracts,
      totalDurationMilliseconds,
      averageDurationMilliseconds,
    });
  }
}
