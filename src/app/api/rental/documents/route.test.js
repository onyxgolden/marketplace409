import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractNativePdfText: vi.fn(),
  visionExtractText: vi.fn(),
}));
vi.mock("@/infrastructure/ocr/extractNativePdfText", () => ({ extractNativePdfText: mocks.extractNativePdfText }));
vi.mock("@/infrastructure/ocr/GoogleCloudVisionOCRAdapter", () => ({
  // mockImplementation must be a real function (constructable with `new`), not an arrow function --
  // route.js calls `new GoogleCloudVisionOCRAdapter()`.
  GoogleCloudVisionOCRAdapter: vi.fn().mockImplementation(function GoogleCloudVisionOCRAdapter() {
    return { extractText: mocks.visionExtractText };
  }),
}));

const from = vi.fn();
const createSignedUrl = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const rpc = vi.fn();
const authenticated = { user: { id: "owner_1" }, supabaseClient: { from, rpc, storage: { from: vi.fn(() => ({ createSignedUrl, upload, remove })) } } };
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn(async () => authenticated) }));
import { DELETE, GET, PATCH, POST } from "./route.js";

// Every query-builder method returns the chain itself (for continued chaining); the chain is also
// directly thenable (for code that awaits mid-chain, e.g. inside Promise.all) and .maybeSingle()/
// .single() resolve immediately, matching how they're actually used in route.js.
function chain(result) {
  const value = {};
  for (const method of ["select", "eq", "is", "or", "neq", "in", "order", "limit", "insert", "update", "textSearch"]) {
    value[method] = vi.fn(() => value);
  }
  value.maybeSingle = vi.fn(async () => result);
  value.single = vi.fn(async () => result);
  value.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return value;
}
function tenantLookup(isTenant) {
  return chain({ data: isTenant ? { id: "tenant_1" } : null, error: null });
}
function request(url, init) {
  return new Request(url, init);
}

describe("rental documents route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractNativePdfText.mockResolvedValue({ text: "native pdf text", extractionMethod: "native_pdf", requiresOCR: false });
    mocks.visionExtractText.mockResolvedValue({ text: "ocr text", extractionMethod: "google_cloud_vision" });
  });

  describe("GET (list)", () => {
    it("lists current-version, non-deleted documents scoped by propertyId with expiration status", async () => {
      const documentQuery = chain({
        data: [{ id: "rental_document_1", property_id: "930 Highland Drive", title: "Survey", expires_at: "2020-01-01" }],
        error: null,
      });
      const acknowledgementQuery = chain({ data: [], error: null });
      const leasePrepQuery = chain({ data: [], error: null });
      const leasePrepVersionQuery = chain({ data: [], error: null });
      from.mockImplementation((table) => ({
        rental_documents: documentQuery, rental_document_acknowledgements: acknowledgementQuery,
        rental_lease_preparations: leasePrepQuery, rental_lease_preparation_versions: leasePrepVersionQuery,
      })[table]);

      const response = await GET(request("https://example.test/api/rental/documents?propertyId=930%20Highland%20Drive"));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(documentQuery.eq).toHaveBeenCalledWith("property_id", "930 Highland Drive");
      expect(documentQuery.eq).toHaveBeenCalledWith("is_current_version", true);
      expect(documentQuery.is).toHaveBeenCalledWith("deleted_at", null);
      expect(body.documents[0].expiration_status).toBe("expired");
      // No eager signed URLs on the list endpoint -- issuing one is a separate, audited action.
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it("applies a full-text search filter when q is provided", async () => {
      const documentQuery = chain({ data: [], error: null });
      from.mockImplementation((table) => (table === "rental_documents" ? documentQuery : chain({ data: [], error: null })));
      await GET(request("https://example.test/api/rental/documents?q=survey%20plat"));
      expect(documentQuery.textSearch).toHaveBeenCalledWith("search_vector", "survey plat", { type: "websearch", config: "english" });
    });
  });

  describe("GET (signed URL preview/download, audited)", () => {
    it("issues a preview URL and records a downloaded audit row", async () => {
      const documentLookup = chain({ data: { id: "rental_document_1", bucket: "rental-documents", object_path: "owner_1/property/930-highland-drive/rental_document_1/survey.pdf" }, error: null });
      const auditInsert = chain({ data: null, error: null });
      from.mockImplementation((table) => (table === "rental_documents" ? documentLookup : table === "rental_tenants" ? tenantLookup(false) : auditInsert));
      createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.test/preview" }, error: null });

      const response = await GET(request("https://example.test/api/rental/documents?documentId=rental_document_1&action=preview"));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.url).toBe("https://signed.test/preview");
      expect(createSignedUrl).toHaveBeenCalledWith("owner_1/property/930-highland-drive/rental_document_1/survey.pdf", 600, undefined);
      expect(auditInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "downloaded", detail: { mode: "preview" } }));
    });

    it("forces a Content-Disposition download when action=download", async () => {
      const documentLookup = chain({ data: { id: "rental_document_1", bucket: "rental-documents", object_path: "path" }, error: null });
      from.mockImplementation((table) => (table === "rental_documents" ? documentLookup : table === "rental_tenants" ? tenantLookup(false) : chain({ data: null, error: null })));
      createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.test/download" }, error: null });
      await GET(request("https://example.test/api/rental/documents?documentId=rental_document_1&action=download"));
      expect(createSignedUrl).toHaveBeenCalledWith("path", 600, { download: true });
    });

    it("404s for a document that doesn't exist or is soft-deleted", async () => {
      const documentLookup = chain({ data: null, error: null });
      from.mockImplementation(() => documentLookup);
      const response = await GET(request("https://example.test/api/rental/documents?documentId=rental_document_missing&action=preview"));
      expect(response.status).toBe(404);
    });
  });

  describe("GET (version history and audit trail)", () => {
    it("rejects a malformed versionsOf id before querying", async () => {
      const response = await GET(request("https://example.test/api/rental/documents?versionsOf=not-a-real-id;drop"));
      expect(response.status).toBe(400);
      expect(from).not.toHaveBeenCalled();
    });

    it("returns every version in a document family, newest first", async () => {
      const versionQuery = chain({ data: [{ id: "rental_document_2", version_number: 2 }, { id: "rental_document_1", version_number: 1 }], error: null });
      from.mockImplementation(() => versionQuery);
      const response = await GET(request("https://example.test/api/rental/documents?versionsOf=rental_document_1"));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(versionQuery.or).toHaveBeenCalledWith("id.eq.rental_document_1,version_of_document_id.eq.rental_document_1");
      expect(body.versions).toHaveLength(2);
    });

    it("returns the combined audit log across every version of a document family", async () => {
      const familyQuery = chain({ data: [{ id: "rental_document_1" }, { id: "rental_document_2" }], error: null });
      const auditQuery = chain({ data: [{ id: "audit_1", document_id: "rental_document_1", action: "uploaded" }], error: null });
      from.mockImplementation((table) => (table === "rental_documents" ? familyQuery : auditQuery));
      const response = await GET(request("https://example.test/api/rental/documents?auditFor=rental_document_1"));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(auditQuery.in).toHaveBeenCalledWith("document_id", ["rental_document_1", "rental_document_2"]);
      expect(body.auditLog).toHaveLength(1);
    });
  });

  describe("POST (upload)", () => {
    it("blocks a linked tenant from publishing documents", async () => {
      from.mockImplementation(() => tenantLookup(true));
      const response = await POST(request("https://example.test/api/rental/documents", { method: "POST", body: new FormData() }));
      expect(response.status).toBe(403);
      expect(upload).not.toHaveBeenCalled();
    });

    it("requires a property or a lease", async () => {
      from.mockImplementation(() => tenantLookup(false));
      const form = new FormData();
      form.set("title", "Survey"); form.set("category", "survey_plat");
      form.set("file", new File(["x"], "survey.pdf", { type: "application/pdf" }));
      const response = await POST(request("https://example.test/api/rental/documents", { method: "POST", body: form }));
      expect(response.status).toBe(400);
    });

    it("validates the property exists in Rental Manager for this owner before uploading", async () => {
      const unitLookup = chain({ data: null, error: null });
      from.mockImplementation((table) => (table === "rental_tenants" ? tenantLookup(false) : unitLookup));
      const form = new FormData();
      form.set("propertyId", "930 Highland Drive"); form.set("title", "Survey"); form.set("category", "survey_plat");
      form.set("file", new File(["x"], "survey.pdf", { type: "application/pdf" }));
      const response = await POST(request("https://example.test/api/rental/documents", { method: "POST", body: form }));
      expect(response.status).toBe(400);
      expect(upload).not.toHaveBeenCalled();
    });

    it("uploads a property-scoped document, extracts native PDF text, and records an 'uploaded' audit row", async () => {
      const unitLookup = chain({ data: { id: "unit_1" }, error: null });
      const insertResult = chain({ data: { id: "rental_document_new", title: "Survey", tenant_visible: false }, error: null });
      const auditInsert = chain({ data: null, error: null });
      from.mockImplementation((table) => ({
        rental_tenants: tenantLookup(false), rental_units: unitLookup,
        rental_documents: insertResult, rental_document_audit_log: auditInsert,
      })[table]);
      upload.mockResolvedValue({ data: { path: "path" }, error: null });

      const form = new FormData();
      form.set("propertyId", "930 Highland Drive"); form.set("title", "Survey / Plat"); form.set("category", "survey_plat");
      form.set("file", new File(["%PDF-1.4"], "survey.pdf", { type: "application/pdf" }));
      const response = await POST(request("https://example.test/api/rental/documents", { method: "POST", body: form }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.document.id).toBe("rental_document_new");
      expect(mocks.extractNativePdfText).toHaveBeenCalled();
      expect(mocks.visionExtractText).not.toHaveBeenCalled();
      expect(insertResult.insert).toHaveBeenCalledWith(expect.objectContaining({
        property_id: "930 Highland Drive", lease_id: null, category: "survey_plat",
        extracted_text: "native pdf text", version_of_document_id: null, version_number: 1, is_current_version: true,
      }));
      expect(auditInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "uploaded" }));
    });

    it("falls back to Vision OCR when native PDF text is insufficient", async () => {
      mocks.extractNativePdfText.mockResolvedValue({ text: "", extractionMethod: "ocr_required", requiresOCR: true });
      const unitLookup = chain({ data: { id: "unit_1" }, error: null });
      const insertResult = chain({ data: { id: "rental_document_new", title: "Survey", tenant_visible: false }, error: null });
      from.mockImplementation((table) => ({
        rental_tenants: tenantLookup(false), rental_units: unitLookup,
        rental_documents: insertResult, rental_document_audit_log: chain({ data: null, error: null }),
      })[table]);
      upload.mockResolvedValue({ data: { path: "path" }, error: null });

      const form = new FormData();
      form.set("propertyId", "930 Highland Drive"); form.set("title", "Scanned Survey"); form.set("category", "survey_plat");
      form.set("file", new File(["scan"], "survey.pdf", { type: "application/pdf" }));
      await POST(request("https://example.test/api/rental/documents", { method: "POST", body: form }));

      expect(mocks.visionExtractText).toHaveBeenCalled();
      expect(insertResult.insert).toHaveBeenCalledWith(expect.objectContaining({ extracted_text: "ocr text" }));
    });

    it("does not fail the upload when text extraction throws -- indexing is best-effort", async () => {
      mocks.extractNativePdfText.mockRejectedValue(new Error("unpdf exploded"));
      const unitLookup = chain({ data: { id: "unit_1" }, error: null });
      const insertResult = chain({ data: { id: "rental_document_new", title: "Survey", tenant_visible: false }, error: null });
      from.mockImplementation((table) => ({
        rental_tenants: tenantLookup(false), rental_units: unitLookup,
        rental_documents: insertResult, rental_document_audit_log: chain({ data: null, error: null }),
      })[table]);
      upload.mockResolvedValue({ data: { path: "path" }, error: null });

      const form = new FormData();
      form.set("propertyId", "930 Highland Drive"); form.set("title", "Survey"); form.set("category", "survey_plat");
      form.set("file", new File(["x"], "survey.pdf", { type: "application/pdf" }));
      const response = await POST(request("https://example.test/api/rental/documents", { method: "POST", body: form }));
      expect(response.status).toBe(200);
      expect(insertResult.insert).toHaveBeenCalledWith(expect.objectContaining({ extracted_text: null }));
    });

    it("uploads a new version, superseding every other row in the family", async () => {
      const unitLookup = chain({ data: { id: "unit_1" }, error: null });
      const predecessorLookup = chain({ data: { id: "rental_document_1", version_of_document_id: null, version_number: 1 }, error: null });
      const latestLookup = chain({ data: { version_number: 1 }, error: null });
      const insertResult = chain({ data: { id: "rental_document_new", title: "Survey", tenant_visible: false }, error: null });
      const supersedeUpdate = chain({ data: null, error: null });
      let documentsCallCount = 0;
      from.mockImplementation((table) => {
        if (table === "rental_tenants") return tenantLookup(false);
        if (table === "rental_units") return unitLookup;
        if (table === "rental_document_audit_log") return chain({ data: null, error: null });
        documentsCallCount += 1;
        if (documentsCallCount === 1) return predecessorLookup;
        if (documentsCallCount === 2) return latestLookup;
        if (documentsCallCount === 3) return insertResult;
        return supersedeUpdate;
      });
      upload.mockResolvedValue({ data: { path: "path" }, error: null });

      const form = new FormData();
      form.set("propertyId", "930 Highland Drive"); form.set("title", "Survey v2"); form.set("category", "survey_plat");
      form.set("versionOfDocumentId", "rental_document_1");
      form.set("file", new File(["v2"], "survey-v2.pdf", { type: "application/pdf" }));
      const response = await POST(request("https://example.test/api/rental/documents", { method: "POST", body: form }));
      expect(response.status).toBe(200);
      expect(insertResult.insert).toHaveBeenCalledWith(expect.objectContaining({ version_of_document_id: "rental_document_1", version_number: 2 }));
      expect(supersedeUpdate.update).toHaveBeenCalledWith({ is_current_version: false });
      expect(supersedeUpdate.or).toHaveBeenCalledWith("id.eq.rental_document_1,version_of_document_id.eq.rental_document_1");
      expect(supersedeUpdate.neq).toHaveBeenCalledWith("id", expect.stringMatching(/^rental_document_/));
    });

    it("rejects an unsupported category", async () => {
      from.mockImplementation(() => tenantLookup(false));
      const form = new FormData();
      form.set("propertyId", "930 Highland Drive"); form.set("title", "Survey"); form.set("category", "not-a-real-category");
      form.set("file", new File(["x"], "survey.pdf", { type: "application/pdf" }));
      const response = await POST(request("https://example.test/api/rental/documents", { method: "POST", body: form }));
      expect(response.status).toBe(400);
    });
  });

  describe("PATCH (edit-metadata)", () => {
    it("blocks a tenant from editing document metadata", async () => {
      from.mockImplementation(() => tenantLookup(true));
      const response = await PATCH(request("https://example.test/api/rental/documents", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "edit-metadata", documentId: "rental_document_1", title: "New title" }),
      }));
      expect(response.status).toBe(403);
    });

    it("edits metadata and records an 'edited' audit row", async () => {
      const existingLookup = chain({ data: { id: "rental_document_1", category: "survey_plat" }, error: null });
      const updateQuery = chain({ data: null, error: null });
      const auditInsert = chain({ data: null, error: null });
      from.mockImplementation((table) => ({
        rental_tenants: tenantLookup(false), rental_documents: existingLookup, rental_document_audit_log: auditInsert,
      })[table] || updateQuery);
      const response = await PATCH(request("https://example.test/api/rental/documents", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "edit-metadata", documentId: "rental_document_1", expiresAt: "2027-01-01" }),
      }));
      expect(response.status).toBe(200);
      expect(auditInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "edited" }));
    });

    it("records 'category_changed' instead of 'edited' when the category actually changes", async () => {
      const existingLookup = chain({ data: { id: "rental_document_1", category: "survey_plat" }, error: null });
      const auditInsert = chain({ data: null, error: null });
      from.mockImplementation((table) => ({
        rental_tenants: tenantLookup(false), rental_documents: existingLookup, rental_document_audit_log: auditInsert,
      })[table] || chain({ data: null, error: null }));
      await PATCH(request("https://example.test/api/rental/documents", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "edit-metadata", documentId: "rental_document_1", category: "deed" }),
      }));
      expect(auditInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "category_changed" }));
    });

    it("still supports the existing acknowledge-document operation", async () => {
      rpc.mockResolvedValue({ data: { document_id: "document_1", tenant_id: "tenant_1" }, error: null });
      const response = await PATCH(request("https://example.test/api/rental/documents", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "acknowledge-document", documentId: "document_1" }),
      }));
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith("acknowledge_rental_document", { p_document_id: "document_1" });
    });
  });

  describe("DELETE (soft delete)", () => {
    it("blocks a tenant from deleting a document", async () => {
      from.mockImplementation(() => tenantLookup(true));
      const response = await DELETE(request("https://example.test/api/rental/documents?documentId=rental_document_1", { method: "DELETE" }));
      expect(response.status).toBe(403);
    });

    it("soft-deletes (sets deleted_at) and never removes the storage object, recording a 'deleted' audit row", async () => {
      const deleteUpdate = chain({ data: { id: "rental_document_1" }, error: null });
      const auditInsert = chain({ data: null, error: null });
      from.mockImplementation((table) => (table === "rental_tenants" ? tenantLookup(false) : table === "rental_document_audit_log" ? auditInsert : deleteUpdate));
      const response = await DELETE(request("https://example.test/api/rental/documents?documentId=rental_document_1", { method: "DELETE" }));
      expect(response.status).toBe(200);
      expect(deleteUpdate.update).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
      expect(remove).not.toHaveBeenCalled();
      expect(auditInsert.insert).toHaveBeenCalledWith(expect.objectContaining({ action: "deleted" }));
    });

    it("404s deleting a document that doesn't exist or is already deleted", async () => {
      const deleteUpdate = chain({ data: null, error: null });
      from.mockImplementation((table) => (table === "rental_tenants" ? tenantLookup(false) : deleteUpdate));
      const response = await DELETE(request("https://example.test/api/rental/documents?documentId=rental_document_missing", { method: "DELETE" }));
      expect(response.status).toBe(404);
    });
  });
});
