import { describe, expect, it } from "vitest";
import {
  DOCUMENT_KIND_SUGGESTIONS, DOCUMENT_ALLOWED_MIME_TYPES, DOCUMENT_MAX_BYTES,
  validateDocumentInput, nextVersionNumber, documentObjectPath,
} from "./workDocuments.js";

const GOOD = {
  name: "RFI-001 form",
  kind: "template",
  mime_type: "application/pdf",
  byte_size: 1024,
  original_filename: "rfi-001.pdf",
};

describe("validateDocumentInput", () => {
  it("accepts a well-formed upload", () => {
    expect(validateDocumentInput(GOOD).ok).toBe(true);
  });
  it("accepts a client-defined kind (free text, not hard-coded)", () => {
    expect(validateDocumentInput({ ...GOOD, kind: "weld-map" }).ok).toBe(true);
  });
  it("rejects a missing name", () => {
    const r = validateDocumentInput({ ...GOOD, name: "  " });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/name is required/);
  });
  it("rejects a missing kind", () => {
    const r = validateDocumentInput({ ...GOOD, kind: "" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/kind is required/);
  });
  it("rejects an unsupported mime type", () => {
    const r = validateDocumentInput({ ...GOOD, mime_type: "application/zip" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/mime_type must be one of/);
  });
  it("rejects an oversized file", () => {
    const r = validateDocumentInput({ ...GOOD, byte_size: DOCUMENT_MAX_BYTES + 1 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/must not exceed/);
  });
  it("rejects a zero-byte file", () => {
    expect(validateDocumentInput({ ...GOOD, byte_size: 0 }).ok).toBe(false);
  });
  it("accepts a version upload", () => {
    expect(validateDocumentInput({ ...GOOD, version_of_document_id: "work_document_1" }).ok).toBe(true);
  });
  it("accepts a filled copy made from a template", () => {
    expect(validateDocumentInput({ ...GOOD, kind: "filled_form", template_source_id: "work_document_9" }).ok).toBe(true);
  });
});

describe("nextVersionNumber", () => {
  it("starts at 1", () => {
    expect(nextVersionNumber(0)).toBe(1);
  });
  it("increments the highest existing", () => {
    expect(nextVersionNumber(3)).toBe(4);
  });
});

describe("documentObjectPath", () => {
  it("scopes the first segment to the workspace owner", () => {
    const p = documentObjectPath("owner_1", "work_document_1", "plan.pdf");
    expect(p.split("/")[0]).toBe("owner_1");
  });
  it("sanitizes the filename", () => {
    const p = documentObjectPath("owner_1", "work_document_1", "my plan (final).pdf");
    expect(p).not.toMatch(/ /);
    expect(p).not.toMatch(/\(/);
  });
});

describe("kind suggestions", () => {
  it("offers the three base kinds", () => {
    expect(DOCUMENT_KIND_SUGGESTIONS).toEqual(
      expect.arrayContaining(["template", "filled_form", "reference"]));
  });
  it("allows office formats for templates and forms", () => {
    expect(DOCUMENT_ALLOWED_MIME_TYPES).toEqual(expect.arrayContaining([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]));
  });
});
