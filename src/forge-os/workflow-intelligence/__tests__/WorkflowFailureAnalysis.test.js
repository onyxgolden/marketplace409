import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowFailureAnalysis,
} from "../index.js";

function createResult({
  workflowId =
    "workflow-failure",
  correlationId =
    "correlation-failure",
  completionStatus =
    "failed",
  governanceDecision,
  outcomes = [],
} = {}) {
  return Object.freeze({
    workflowId,
    correlationId,
    completionStatus,
    governanceDecision,
    outcomes: Object.freeze([
      ...outcomes,
    ]),
  });
}

function createOutcome({
  capability =
    "repository.inspect",
  managerIdentity =
    "repository-intelligence-manager",
  completionStatus =
    "failed",
  failureClassification,
  validationRequirements = [],
  producedEvidence = [],
} = {}) {
  return Object.freeze({
    payload: Object.freeze({
      capabilityInvoked:
        capability,
      managerIdentity,
      completionStatus,
      failureClassification,
      validationRequirements:
        Object.freeze([
          ...validationRequirements,
        ]),
      producedEvidence:
        Object.freeze([
          ...producedEvidence,
        ]),
    }),
  });
}

describe(
  "WorkflowFailureAnalysis",
  () => {
    it(
      "classifies explicit manager failures",
      () => {
        const failures =
          new WorkflowFailureAnalysis()
            .analyze(
              createResult({
                outcomes: [
                  createOutcome({
                    failureClassification:
                      "repository-unavailable",
                  }),
                ],
              }),
            );

        expect(failures).toEqual([
          {
            workflowId:
              "workflow-failure",
            correlationId:
              "correlation-failure",
            failureType:
              "repository-unavailable",
            capability:
              "repository.inspect",
            managerIdentity:
              "repository-intelligence-manager",
            reason:
              "repository-unavailable",
          },
        ]);
      },
    );

    it(
      "classifies workflow governance rejection",
      () => {
        const failures =
          new WorkflowFailureAnalysis()
            .analyze(
              createResult({
                governanceDecision: {
                  decision:
                    "rejected",
                  reason:
                    "Authority required.",
                },
                outcomes: [],
              }),
            );

        expect(failures).toEqual([
          {
            workflowId:
              "workflow-failure",
            correlationId:
              "correlation-failure",
            failureType:
              "governance-rejection",
            capability: null,
            managerIdentity: null,
            reason:
              "Authority required.",
          },
        ]);
      },
    );

    it(
      "classifies interrupted workflows",
      () => {
        const failures =
          new WorkflowFailureAnalysis()
            .analyze(
              createResult({
                completionStatus:
                  "interrupted",
                outcomes: [],
              }),
            );

        expect(failures[0]).toEqual({
          workflowId:
            "workflow-failure",
          correlationId:
            "correlation-failure",
          failureType:
            "lifecycle-interruption",
          capability: null,
          managerIdentity: null,
          reason:
            "Workflow execution was interrupted.",
        });
      },
    );

    it(
      "classifies validation and evidence failures deterministically",
      () => {
        const failures =
          new WorkflowFailureAnalysis()
            .analyze([
              createResult({
                workflowId:
                  "workflow-validation",
                outcomes: [
                  createOutcome({
                    validationRequirements: [
                      "structural-validation",
                    ],
                    producedEvidence: [
                      "evidence-1",
                    ],
                  }),
                ],
              }),
              createResult({
                workflowId:
                  "workflow-evidence",
                outcomes: [
                  createOutcome({
                    validationRequirements:
                      [],
                    producedEvidence: [],
                  }),
                ],
              }),
            ]);

        expect(
          failures.map(
            (failure) =>
              failure.failureType,
          ),
        ).toEqual([
          "validation-failure",
          "evidence-failure",
        ]);
      },
    );

    it(
      "ignores completed outcomes",
      () => {
        const failures =
          new WorkflowFailureAnalysis()
            .analyze(
              createResult({
                completionStatus:
                  "completed",
                outcomes: [
                  createOutcome({
                    completionStatus:
                      "completed",
                  }),
                ],
              }),
            );

        expect(failures).toEqual([]);
      },
    );

    it(
      "returns immutable failure analysis",
      () => {
        const failures =
          new WorkflowFailureAnalysis()
            .analyze([]);

        expect(
          Object.isFrozen(failures),
        ).toBe(true);
      },
    );

    it(
      "rejects unsupported sources",
      () => {
        expect(
          () =>
            new WorkflowFailureAnalysis()
              .analyze(null),
        ).toThrow(
          "WorkflowFailureAnalysis requires workflow results or a result array.",
        );
      },
    );
  },
);
