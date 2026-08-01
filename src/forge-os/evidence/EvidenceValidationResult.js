function freezeFindings(findings) {
  return Object.freeze(
    findings.map((finding) =>
      Object.freeze({
        ...finding,
      }),
    ),
  );
}

export function createEvidenceValidationResult({
  evidenceId,
  status,
  findings = [],
} = {}) {
  if (!Array.isArray(findings)) {
    throw new TypeError(
      "findings must be an array.",
    );
  }

  const frozenFindings =
    freezeFindings(findings);

  return Object.freeze({
    evidenceId,
    status,
    valid: frozenFindings.length === 0,
    findings: frozenFindings,
  });
}
