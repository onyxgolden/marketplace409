import {
  runGovernancePipeline,
} from "./runGovernancePipeline.mjs";

import {
  selectEligibleValidationEvidence,
} from "./selectEligibleValidationEvidence.mjs";

try {
  const selection =
    selectEligibleValidationEvidence();

  if (
    selection.selected ===
      null
  ) {
    throw new Error(
      "No eligible validation evidence is available for governance enforcement.",
    );
  }

  runGovernancePipeline({
    mode: "shadow",
    validationEvidencePath:
      selection.selected.path,
  });
} catch (error) {
  console.error(
    `FAIL: ${error.message}`,
  );
  process.exit(1);
}
