import {
  createEvidenceValidationResult,
} from "./EvidenceValidationResult.js";

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
  findings.push({
    code,
    path,
    message,
  });
}

export class EvidenceValidator {
  validate(evidenceRecord) {
    const findings = [];

    if (
      !evidenceRecord ||
      !evidenceRecord.payload
    ) {
      addFinding(findings, {
        code: "invalid_evidence_record",
        path: "evidenceRecord",
        message:
          "Evidence record must contain a payload.",
      });

      return createEvidenceValidationResult({
        evidenceId: null,
        status: "rejected",
        findings,
      });
    }

    const {
      evidenceId,
      sourceComponent,
      validationStatus,
      artifacts,
    } = evidenceRecord.payload;

    if (!isNonEmptyString(evidenceId)) {
      addFinding(findings, {
        code: "missing_evidence_id",
        path: "payload.evidenceId",
        message:
          "Evidence ID must be a non-empty string.",
      });
    }

    if (!isNonEmptyString(sourceComponent)) {
      addFinding(findings, {
        code: "missing_source_component",
        path: "payload.sourceComponent",
        message:
          "Source component must be a non-empty string.",
      });
    }

    if (
      ![
        "pending",
        "passed",
        "failed",
      ].includes(validationStatus)
    ) {
      addFinding(findings, {
        code: "invalid_validation_status",
        path: "payload.validationStatus",
        message:
          "Evidence validation status is invalid.",
      });
    }

    if (
      artifacts !== undefined &&
      !Array.isArray(artifacts)
    ) {
      addFinding(findings, {
        code: "invalid_artifacts",
        path: "payload.artifacts",
        message:
          "Evidence artifacts must be an array.",
      });
    }

    return createEvidenceValidationResult({
      evidenceId,
      status:
        findings.length === 0
          ? "validated"
          : "rejected",
      findings,
    });
  }
}
