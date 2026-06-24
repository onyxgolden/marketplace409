import { describe, expect, test } from "vitest";
import { ImportWarning } from "../ImportWarning";

describe("ImportWarning", () => {
  test("constructs with required fields", () => {
    const warning = new ImportWarning({
      code: "UNKNOWN_CATEGORY",
      message: "Category could not be mapped.",
    });

    expect(warning.code).toBe("UNKNOWN_CATEGORY");
    expect(warning.severity).toBe("warning");
    expect(warning.message).toBe("Category could not be mapped.");
    expect(warning.rowNumber).toBeNull();
    expect(warning.metadata).toEqual({});
  });

  test("constructs with all fields", () => {
    const warning = new ImportWarning({
      code: "INVALID_DATE",
      severity: "error",
      message: "Date format is invalid.",
      rowNumber: 12,
      metadata: {
        value: "13/45/2026",
      },
    });

    expect(warning.code).toBe("INVALID_DATE");
    expect(warning.severity).toBe("error");
    expect(warning.message).toBe("Date format is invalid.");
    expect(warning.rowNumber).toBe(12);
    expect(warning.metadata).toEqual({
      value: "13/45/2026",
    });
  });

  test("rejects missing code", () => {
    expect(() => {
      new ImportWarning({
        message: "Missing code",
      });
    }).toThrow("ImportWarning requires a code");
  });

  test("rejects missing message", () => {
    expect(() => {
      new ImportWarning({
        code: "TEST",
      });
    }).toThrow("ImportWarning requires a message");
  });

  test("rejects invalid severity", () => {
    expect(() => {
      new ImportWarning({
        code: "TEST",
        message: "Invalid severity",
        severity: "critical",
      });
    }).toThrow("ImportWarning severity must be one of");
  });

  test("rejects invalid row number", () => {
    expect(() => {
      new ImportWarning({
        code: "TEST",
        message: "Bad row",
        rowNumber: 0,
      });
    }).toThrow("ImportWarning rowNumber must be a positive integer or null");
  });

  test("rejects invalid metadata", () => {
    expect(() => {
      new ImportWarning({
        code: "TEST",
        message: "Bad metadata",
        metadata: [],
      });
    }).toThrow("ImportWarning metadata must be an object");
  });

  test("is immutable", () => {
    const warning = new ImportWarning({
      code: "TEST",
      message: "Immutable",
    });

    expect(Object.isFrozen(warning)).toBe(true);
    expect(Object.isFrozen(warning.metadata)).toBe(true);
  });

  test("serializes to JSON", () => {
    const warning = new ImportWarning({
      code: "UNKNOWN_CATEGORY",
      message: "Category could not be mapped.",
      rowNumber: 5,
      metadata: {
        category: "Misc",
      },
    });

    expect(warning.toJSON()).toEqual({
      code: "UNKNOWN_CATEGORY",
      severity: "warning",
      message: "Category could not be mapped.",
      rowNumber: 5,
      metadata: {
        category: "Misc",
      },
    });
  });
});
