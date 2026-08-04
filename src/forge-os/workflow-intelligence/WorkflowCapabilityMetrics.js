function getResults(source) {
  if (Array.isArray(source)) {
    return source;
  }

  if (
    source &&
    Array.isArray(source.outcomes)
  ) {
    return [source];
  }

  throw new Error(
    "WorkflowCapabilityMetrics requires workflow results or a result array.",
  );
}

function getDurationMilliseconds(outcome) {
  const duration =
    outcome?.payload
      ?.timingInformation
      ?.durationMilliseconds;

  return (
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration >= 0
  )
    ? duration
    : 0;
}

export class WorkflowCapabilityMetrics {
  analyze(source) {
    const results =
      getResults(source);

    const metrics = new Map();

    for (const result of results) {
      for (const outcome of result.outcomes) {
        const capability =
          outcome?.payload
            ?.capabilityInvoked;

        if (
          typeof capability !== "string" ||
          capability.length === 0
        ) {
          continue;
        }

        const current =
          metrics.get(capability) ?? {
            capability,
            executionCount: 0,
            successfulExecutions: 0,
            failedExecutions: 0,
            totalDurationMilliseconds: 0,
          };

        current.executionCount += 1;

        if (
          outcome.payload
            .completionStatus ===
          "completed"
        ) {
          current.successfulExecutions += 1;
        } else {
          current.failedExecutions += 1;
        }

        current.totalDurationMilliseconds +=
          getDurationMilliseconds(outcome);

        metrics.set(
          capability,
          current,
        );
      }
    }

    const normalized =
      Array.from(metrics.values())
        .sort(
          (left, right) =>
            left.capability.localeCompare(
              right.capability,
            ),
        )
        .map((metric) => {
          const successRate =
            metric.executionCount === 0
              ? 0
              : metric.successfulExecutions /
                metric.executionCount;

          const failureRate =
            metric.executionCount === 0
              ? 0
              : metric.failedExecutions /
                metric.executionCount;

          const averageDurationMilliseconds =
            metric.executionCount === 0
              ? 0
              : metric
                  .totalDurationMilliseconds /
                metric.executionCount;

          return Object.freeze({
            ...metric,
            successRate,
            failureRate,
            averageDurationMilliseconds,
          });
        });

    return Object.freeze(
      normalized,
    );
  }
}
