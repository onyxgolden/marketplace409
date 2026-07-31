import {
  createContractValidationResult,
} from "../contracts/v1/core/index.js";

function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

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

export function validateContextContribution({
  managerIdentity,
  contextContribution,
  evidenceReferences = [],
}) {
  const findings = [];

  if (!isNonEmptyString(managerIdentity)) {
    findings.push({
      code:
        "invalid_manager_identity",
      path:
        "managerIdentity",
      message:
        "Manager identity must be a non-empty string.",
    });
  }

  if (!isPlainObject(contextContribution)) {
    findings.push({
      code:
        "invalid_context_contribution",
      path:
        "contextContribution",
      message:
        "Context contribution must be a plain object.",
    });
  }

  if (!Array.isArray(evidenceReferences)) {
    findings.push({
      code:
        "invalid_evidence_references",
      path:
        "evidenceReferences",
      message:
        "Evidence references must be an array.",
    });
  } else {
    evidenceReferences.forEach(
      (reference, index) => {
        if (!isNonEmptyString(reference)) {
          findings.push({
            code:
              "invalid_evidence_reference",
            path:
              `evidenceReferences[${index}]`,
            message:
              "Evidence references must be non-empty strings.",
          });
        }
      },
    );
  }

  return createContractValidationResult({
    findings,
  });
}
