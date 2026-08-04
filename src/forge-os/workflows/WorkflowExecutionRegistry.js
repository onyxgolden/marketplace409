import {
  WorkflowExecutionRecord,
} from "./WorkflowExecutionRecord.js";

export class WorkflowExecutionRegistry {
  constructor() {
    this.executionRecords =
      new Map();
  }

  register(executionRecord) {
    if (
      !(executionRecord instanceof
        WorkflowExecutionRecord)
    ) {
      throw new Error(
        "WorkflowExecutionRegistry requires a WorkflowExecutionRecord.",
      );
    }

    const {
      executionId,
    } = executionRecord;

    if (
      this.executionRecords.has(
        executionId,
      )
    ) {
      throw new Error(
        `Workflow execution already registered: ${executionId}`,
      );
    }

    this.executionRecords.set(
      executionId,
      executionRecord,
    );

    return executionRecord;
  }

  get(executionId) {
    return (
      this.executionRecords.get(
        executionId,
      ) || null
    );
  }

  has(executionId) {
    return this.executionRecords.has(
      executionId,
    );
  }

  list() {
    return Object.freeze(
      Array.from(
        this.executionRecords
          .values(),
      ),
    );
  }

  listByWorkflowId(workflowId) {
    return Object.freeze(
      this.list().filter(
        (record) =>
          record.workflowId ===
          workflowId,
      ),
    );
  }
}
