import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../work-packages/_lib/auth.js", () => ({
  workAuth: vi.fn(),
  ok: (body, status = 200) => Response.json(body, { status }),
  fail: (result) => Response.json({ error: result.error }, { status: result.httpStatus || 400 }),
  serverError: () => Response.json({ error: "Unable to complete the request." }, { status: 500 }),
}));
vi.mock("@/application/work-management/workDocuments", () => ({
  listDocuments: vi.fn(),
  uploadDocument: vi.fn(),
  getDocumentUrl: vi.fn(),
  deleteDocument: vi.fn(),
}));

import { workAuth } from "../work-packages/_lib/auth.js";
import {
  listDocuments, uploadDocument, getDocumentUrl, deleteDocument,
} from "@/application/work-management/workDocuments";
import { GET, POST, DELETE } from "./route.js";

const AUTH = { db: {}, ownerId: "owner_1", actor: "user_1" };

beforeEach(() => {
  vi.clearAllMocks();
  workAuth.mockResolvedValue(AUTH);
});

describe("GET /api/work-documents", () => {
  it("lists the workspace library", async () => {
    listDocuments.mockResolvedValue([{ id: "work_document_1" }]);
    const res = await GET(new Request("http://x/api/work-documents"));
    expect(res.status).toBe(200);
    expect((await res.json()).documents).toHaveLength(1);
    expect(listDocuments).toHaveBeenCalledWith(AUTH.db, "owner_1",
      { kind: null, includeSuperseded: false });
  });
  it("returns a signed URL when documentId is given", async () => {
    getDocumentUrl.mockResolvedValue({ ok: true, url: "https://signed.example/x" });
    const res = await GET(new Request("http://x/api/work-documents?documentId=work_document_1&action=preview"));
    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://signed.example/x");
  });
  it("404s a missing document", async () => {
    getDocumentUrl.mockResolvedValue({ ok: false, error: "Document not found." });
    const res = await GET(new Request("http://x/api/work-documents?documentId=nope"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/work-documents", () => {
  it("uploads a file and returns the document", async () => {
    uploadDocument.mockResolvedValue({ ok: true, document: { id: "work_document_1" } });
    const form = new FormData();
    form.append("file", new File(["x"], "rfi.pdf", { type: "application/pdf" }));
    form.append("name", "RFI-001");
    form.append("kind", "template");
    const res = await POST(new Request("http://x/api/work-documents", { method: "POST", body: form }));
    expect(res.status).toBe(201);
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const call = uploadDocument.mock.calls[0];
    expect(call[1]).toBe("owner_1");
    expect(call[3].name).toBe("rfi.pdf");
    expect(call[3].type).toBe("application/pdf");
    expect(call[4].name).toBe("RFI-001");
    expect(call[4].kind).toBe("template");
  });
  it("400s when no file is attached", async () => {
    const res = await POST(new Request("http://x/api/work-documents",
      { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
    expect(uploadDocument).not.toHaveBeenCalled();
  });
  it("400s invalid input", async () => {
    uploadDocument.mockResolvedValue({ ok: false, errors: ["Document name is required."] });
    const form = new FormData();
    form.append("file", new File(["x"], "rfi.pdf", { type: "application/pdf" }));
    const res = await POST(new Request("http://x/api/work-documents", { method: "POST", body: form }));
    expect(res.status).toBe(400);
  });
  it("409s a revision race as retryable", async () => {
    uploadDocument.mockResolvedValue({
      ok: false, retryable: true, errors: ["Another version was uploaded at the same time — please retry."],
    });
    const form = new FormData();
    form.append("file", new File(["x"], "rfi.pdf", { type: "application/pdf" }));
    const res = await POST(new Request("http://x/api/work-documents", { method: "POST", body: form }));
    expect(res.status).toBe(409);
    expect((await res.json()).retryable).toBe(true);
  });
});

describe("DELETE /api/work-documents", () => {
  it("deletes a document", async () => {
    deleteDocument.mockResolvedValue({ ok: true });
    const res = await DELETE(new Request("http://x/api/work-documents?documentId=work_document_1"));
    expect(res.status).toBe(200);
    expect(deleteDocument).toHaveBeenCalledWith(AUTH.db, "owner_1", "work_document_1");
  });
  it("400s without a documentId", async () => {
    const res = await DELETE(new Request("http://x/api/work-documents"));
    expect(res.status).toBe(400);
  });
});
