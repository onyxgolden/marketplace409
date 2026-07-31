import {
  createContractValidationResult,
} from "./ContractValidationResult.js";

function isPlainObject(value) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function addFinding(
  findings,
  {
    code,
    path,
    message,
  },
) {
  findings.push(
    Object.freeze({
      code,
      path,
      message,
    }),
  );
}

function validateRequiredString(
  value,
  path,
  findings,
) {
  if (!isNonEmptyString(value)) {
    addFinding(findings, {
      code: "required_non_empty_string",
      path,
      message:
        `${path} must be a non-empty string.`,
    });
  }
}

function validateOptionalString(
  value,
  path,
  findings,
) {
  if (
    value !== undefined &&
    !isNonEmptyString(value)
  ) {
    addFinding(findings, {
      code: "optional_non_empty_string",
      path,
      message:
        `${path} must be undefined or a non-empty string.`,
    });
  }
}

function validateVersion(version, findings) {
  if (!isPlainObject(version)) {
    addFinding(findings, {
      code: "invalid_object",
      path: "metadata.version",
      message:
        "metadata.version must be a plain object.",
    });

    return;
  }

  for (const field of [
    "major",
    "minor",
    "patch",
  ]) {
    const value = version[field];

    if (
      !Number.isInteger(value) ||
      value < 0
    ) {
      addFinding(findings, {
        code: "invalid_semantic_version_number",
        path: `metadata.version.${field}`,
        message:
          `metadata.version.${field} must be a non-negative integer.`,
      });
    }
  }

  if (
    Number.isInteger(version.major) &&
    version.major >= 0 &&
    Number.isInteger(version.minor) &&
    version.minor >= 0 &&
    Number.isInteger(version.patch) &&
    version.patch >= 0
  ) {
    const expectedIdentifier =
      `${version.major}.${version.minor}.${version.patch}`;

    if (
      version.identifier !== expectedIdentifier
    ) {
      addFinding(findings, {
        code: "version_identifier_mismatch",
        path: "metadata.version.identifier",
        message:
          "metadata.version.identifier must match major.minor.patch.",
      });
    }
  } else {
    validateRequiredString(
      version.identifier,
      "metadata.version.identifier",
      findings,
    );
  }
}

function validateMetadata(metadata, findings) {
  if (!isPlainObject(metadata)) {
    addFinding(findings, {
      code: "invalid_object",
      path: "metadata",
      message:
        "metadata must be a plain object.",
    });

    return;
  }

  validateRequiredString(
    metadata.contractId,
    "metadata.contractId",
    findings,
  );

  validateRequiredString(
    metadata.contractType,
    "metadata.contractType",
    findings,
  );

  validateRequiredString(
    metadata.description,
    "metadata.description",
    findings,
  );

  validateVersion(
    metadata.version,
    findings,
  );
}

function validateOrigin(origin, findings) {
  if (!isPlainObject(origin)) {
    addFinding(findings, {
      code: "invalid_object",
      path: "provenance.origin",
      message:
        "provenance.origin must be a plain object.",
    });

    return;
  }

  validateRequiredString(
    origin.componentType,
    "provenance.origin.componentType",
    findings,
  );

  validateRequiredString(
    origin.componentId,
    "provenance.origin.componentId",
    findings,
  );
}

function validateEvidenceReferences(
  evidenceReferences,
  findings,
) {
  if (!Array.isArray(evidenceReferences)) {
    addFinding(findings, {
      code: "invalid_array",
      path: "provenance.evidenceReferences",
      message:
        "provenance.evidenceReferences must be an array.",
    });

    return;
  }

  evidenceReferences.forEach(
    (reference, index) => {
      if (!isNonEmptyString(reference)) {
        addFinding(findings, {
          code: "invalid_evidence_reference",
          path:
            `provenance.evidenceReferences[${index}]`,
          message:
            "Evidence references must be non-empty strings.",
        });
      }
    },
  );
}

function validateProvenance(
  provenance,
  findings,
) {
  if (!isPlainObject(provenance)) {
    addFinding(findings, {
      code: "invalid_object",
      path: "provenance",
      message:
        "provenance must be a plain object.",
    });

    return;
  }

  validateRequiredString(
    provenance.requestId,
    "provenance.requestId",
    findings,
  );

  validateRequiredString(
    provenance.workflowId,
    "provenance.workflowId",
    findings,
  );

  validateRequiredString(
    provenance.correlationId,
    "provenance.correlationId",
    findings,
  );

  validateOptionalString(
    provenance.causationId,
    "provenance.causationId",
    findings,
  );

  validateOptionalString(
    provenance.parentContractId,
    "provenance.parentContractId",
    findings,
  );

  validateOrigin(
    provenance.origin,
    findings,
  );

  validateRequiredString(
    provenance.contextVersion,
    "provenance.contextVersion",
    findings,
  );

  validateEvidenceReferences(
    provenance.evidenceReferences,
    findings,
  );
}

export function validateContractStructure(
  contract,
) {
  const findings = [];

  if (!isPlainObject(contract)) {
    addFinding(findings, {
      code: "invalid_contract_envelope",
      path: "$",
      message:
        "Contract must be a plain object.",
    });

    return createContractValidationResult({
      findings,
    });
  }

  validateMetadata(
    contract.metadata,
    findings,
  );

  if (!isPlainObject(contract.payload)) {
    addFinding(findings, {
      code: "invalid_object",
      path: "payload",
      message:
        "payload must be a plain object.",
    });
  }

  validateProvenance(
    contract.provenance,
    findings,
  );

  return createContractValidationResult({
    findings,
  });
}
