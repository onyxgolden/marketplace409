export class ImportWarning {
  constructor({
    code,
    severity = "warning",
    message,
    rowNumber = null,
    metadata = {},
  }) {
    if (!code || typeof code !== "string") {
      throw new Error("ImportWarning requires a code");
    }

    if (!message || typeof message !== "string") {
      throw new Error("ImportWarning requires a message");
    }

    const validSeverities = ["info", "warning", "error"];

    if (!validSeverities.includes(severity)) {
      throw new Error(
        `ImportWarning severity must be one of: ${validSeverities.join(", ")}`
      );
    }

    if (
      rowNumber !== null &&
      (!Number.isInteger(rowNumber) || rowNumber < 1)
    ) {
      throw new Error(
        "ImportWarning rowNumber must be a positive integer or null"
      );
    }

    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new Error("ImportWarning metadata must be an object");
    }

    this.code = code;
    this.severity = severity;
    this.message = message;
    this.rowNumber = rowNumber;
    this.metadata = Object.freeze({ ...metadata });

    Object.freeze(this);
  }

  toJSON() {
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      rowNumber: this.rowNumber,
      metadata: this.metadata,
    };
  }
}
