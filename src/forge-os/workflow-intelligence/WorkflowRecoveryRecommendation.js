const RECOVERY_RULES = Object.freeze({
  "governance-rejection":
    Object.freeze({
      action:
        "request-authority",
      priority:
        "high",
      reason:
        "Workflow execution requires an approved authority decision.",
    }),

  "validation-failure":
    Object.freeze({
      action:
        "rerun-validation",
      priority:
        "high",
      reason:
        "Validation requirements were not satisfied.",
    }),

  "evidence-failure":
    Object.freeze({
      action:
        "reproduce-evidence",
      priority:
        "high",
      reason:
        "Required execution evidence was not produced or accepted.",
    }),

  "lifecycle-interruption":
    Object.freeze({
      action:
        "resume-or-rebuild-workflow",
      priority:
        "medium",
      reason:
        "Workflow execution was interrupted before completion.",
    }),

  "repository-unavailable":
    Object.freeze({
      action:
        "reinspect-repository",
      priority:
        "high",
      reason:
        "Repository access or repository state must be restored before retry.",
    }),

  "manager-execution-failure":
    Object.freeze({
      action:
        "retry-capability",
      priority:
        "medium",
      reason:
        "The manager capability did not complete successfully.",
    }),
});

export class WorkflowRecoveryRecommendation {
  recommend(failures) {
    if (!Array.isArray(failures)) {
      throw new Error(
        "WorkflowRecoveryRecommendation requires a failure array.",
      );
    }

    const recommendations =
      failures.map((failure) => {
        const rule =
          RECOVERY_RULES[
            failure.failureType
          ] ??
          Object.freeze({
            action:
              "manual-review",
            priority:
              "medium",
            reason:
              "No deterministic recovery rule exists for this failure type.",
          });

        return Object.freeze({
          workflowId:
            failure.workflowId ??
            null,
          correlationId:
            failure.correlationId ??
            null,
          failureType:
            failure.failureType,
          capability:
            failure.capability ??
            null,
          managerIdentity:
            failure.managerIdentity ??
            null,
          action:
            rule.action,
          priority:
            rule.priority,
          reason:
            rule.reason,
        });
      });

    return Object.freeze(
      recommendations,
    );
  }
}
