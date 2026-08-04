import {
  createForgeRuntime,
} from "../../runtime/index.js";

import {
  EngineeringObjectiveExecutor,
} from "./EngineeringObjectiveExecutor.js";

export function createEngineeringObjectiveExecutor({
  runtime =
    createForgeRuntime(),
  planner,
  workflowRegistry,
  executionRegistry,
  workflowExecutor,
  clock,
} = {}) {
  return new EngineeringObjectiveExecutor({
    runtime,
    planner,
    workflowRegistry,
    executionRegistry,
    workflowExecutor,
    clock,
  });
}
