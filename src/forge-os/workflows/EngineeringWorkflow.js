import {
  WorkflowDefinition,
} from "./WorkflowDefinition.js";

export class EngineeringWorkflow
  extends WorkflowDefinition {
  constructor(input) {
    try {
      super(input);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.replace(
              /^WorkflowDefinition/,
              "EngineeringWorkflow",
            )
          : String(error);

      throw new Error(message);
    }
  }
}
