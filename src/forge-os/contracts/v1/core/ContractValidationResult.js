function freezeFindings(findings) {
  return Object.freeze(
    findings.map((finding) =>
      Object.freeze({
        ...finding,
      }),
    ),
  );
}

export function createContractValidationResult({
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
    valid: frozenFindings.length === 0,
    findings: frozenFindings,
  });
}
