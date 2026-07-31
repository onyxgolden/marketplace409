import {
  createContractValidationResult,
} from "../contracts/v1/core/index.js";

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return false;
  }

  const prototype =
    Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

export function validateContextContribution(
  contribution,
) {
  const findings = [];

  if (!isPlainObject(contribution)) {
    findings.push({
      code:
        "invalid_context_contribution",
      path:
        "contextContribution",
      message:
        "Context contribution must be a plain object.",
    });
  }

  return createContractValidationResult({
    findings,
  });
}
