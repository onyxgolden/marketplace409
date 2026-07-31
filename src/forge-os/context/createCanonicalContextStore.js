import {
  buildCanonicalEngineeringContext,
  CanonicalEngineeringContextStore,
} from "./index.js";

export function createCanonicalContextStore() {
  const context =
    buildCanonicalEngineeringContext({
      contextIdentity:
        "forge-canonical-context-v1",
      provenance: {
        requestId:
          "forge-context-bootstrap",
        workflowId:
          "forge-runtime-bootstrap",
        correlationId:
          "forge-context-bootstrap",
        origin: {
          componentType:
            "context-factory",
          componentId:
            "create-canonical-context-store",
        },
        contextVersion:
          "1.0.0",
      },
      repositoryState: Object.freeze({}),
      memoryState: Object.freeze({}),
      governanceState: Object.freeze({}),
      executionState: Object.freeze({}),
      validationState: Object.freeze({}),
      authorityState: Object.freeze({}),
      evidenceReferences: [],
    });

  return new CanonicalEngineeringContextStore(
    context,
  );
}
