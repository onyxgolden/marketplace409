import {
  WorkflowCapabilityMetrics,
} from "./WorkflowCapabilityMetrics.js";

import {
  WorkflowExecutionStatistics,
} from "./WorkflowExecutionStatistics.js";

import {
  WorkflowFailureAnalysis,
} from "./WorkflowFailureAnalysis.js";

import {
  WorkflowRecoveryRecommendation,
} from "./WorkflowRecoveryRecommendation.js";

export class WorkflowIntelligence {
  constructor({
    executionStatistics =
      new WorkflowExecutionStatistics(),
    capabilityMetrics =
      new WorkflowCapabilityMetrics(),
    failureAnalysis =
      new WorkflowFailureAnalysis(),
    recoveryRecommendation =
      new WorkflowRecoveryRecommendation(),
  } = {}) {
    this.executionStatistics =
      executionStatistics;
    this.capabilityMetrics =
      capabilityMetrics;
    this.failureAnalysis =
      failureAnalysis;
    this.recoveryRecommendation =
      recoveryRecommendation;

    Object.freeze(this);
  }

  analyze({
    executionHistory,
    workflowResults,
  }) {
    if (
      executionHistory === undefined
    ) {
      throw new Error(
        "WorkflowIntelligence requires executionHistory.",
      );
    }

    if (
      workflowResults === undefined
    ) {
      throw new Error(
        "WorkflowIntelligence requires workflowResults.",
      );
    }

    const statistics =
      this.executionStatistics.analyze(
        executionHistory,
      );

    const capabilityMetrics =
      this.capabilityMetrics.analyze(
        workflowResults,
      );

    const failures =
      this.failureAnalysis.analyze(
        workflowResults,
      );

    const recommendations =
      this.recoveryRecommendation
        .recommend(failures);

    return Object.freeze({
      statistics,
      capabilityMetrics,
      failures,
      recommendations,
    });
  }
}
