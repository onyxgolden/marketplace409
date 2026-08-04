function getResults(source) {
  if (Array.isArray(source)) {
    return source;
  }

  if (
    source &&
    typeof source === "object"
  ) {
    return [source];
  }

  throw new Error(
    "WorkflowFailureAnalysis requires workflow results or a result array.",
  );
}

function classifyOutcomeFailure(outcome) {
  const payload =
    outcome?.payload ?? {};

  const failureClassification =
    payload.failureClassification;

  if (
    typeof failureClassification ===
      "string" &&
    failureClassification.length > 0
  ) {
    return failureClassification;
  }

  if (
    Array.isArray(
      payload.validationRequirements,
    ) &&
    payload.validationRequirements
      .length > 0 &&
    payload.completionStatus === "failed"
  ) {
    return "validation-failure";
  }

  if (
    Array.isArray(
      payload.producedEvidence,
    ) &&
    payload.producedEvidence.length === 0 &&
    payload.completionStatus === "failed"
  ) {
    return "evidence-failure";
  }

  return "manager-execution-failure";
}

export class WorkflowFailureAnalysis {
  analyze(source) {
    const results =
      getResults(source);

    const failures = [];

    for (const result of results) {
      const governanceDecision =
        result?.governanceDecision;

      if (
        governanceDecision?.decision ===
        "rejected"
      ) {
        failures.push(
          Object.freeze({
            workflowId:
              result.workflowId ?? null,
            correlationId:
              result.correlationId ?? null,
            failureType:
              "governance-rejection",
            capability: null,
            managerIdentity: null,
            reason:
              governanceDecision.reason ??
              "Workflow governance rejected execution.",
          }),
        );
      }

      if (
        result?.completionStatus ===
        "interrupted"
      ) {
        failures.push(
          Object.freeze({
            workflowId:
              result.workflowId ?? null,
            correlationId:
              result.correlationId ?? null,
            failureType:
              "lifecycle-interruption",
            capability: null,
            managerIdentity: null,
            reason:
              "Workflow execution was interrupted.",
          }),
        );
      }

      const outcomes =
        Array.isArray(result?.outcomes)
          ? result.outcomes
          : [];

      for (const outcome of outcomes) {
        if (
          outcome?.payload
            ?.completionStatus ===
          "completed"
        ) {
          continue;
        }

        failures.push(
          Object.freeze({
            workflowId:
              result.workflowId ?? null,
            correlationId:
              result.correlationId ?? null,
            failureType:
              classifyOutcomeFailure(
                outcome,
              ),
            capability:
              outcome?.payload
                ?.capabilityInvoked ??
              null,
            managerIdentity:
              outcome?.payload
                ?.managerIdentity ??
              null,
            reason:
              outcome?.payload
                ?.failureClassification ??
              "Manager outcome did not complete successfully.",
          }),
        );
      }
    }

    return Object.freeze(
      failures,
    );
  }
}
