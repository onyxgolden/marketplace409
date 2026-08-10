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

  const governanceResult =
runGovernancePipeline({
  mode: "shadow",
  validationEvidencePath:
    selection.selected.path,
});

if (
  governanceResult?.status !==
    "completed"
) {
  throw new Error(
    "Shadow governance pipeline did not return a completed execution receipt.",
  );
}
} catch (error) {
  console.error(
    `FAIL: ${error.message}`,
  );
  process.exit(1);
}
