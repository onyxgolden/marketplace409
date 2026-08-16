import { beforeEach, describe, expect, it, vi } from "vitest";
const from = vi.fn();
const createSignedUrl = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const authenticated = { user: { id: "owner_1" }, supabaseClient: { from, storage: { from: vi.fn(() => ({ createSignedUrl, upload, remove })) } } };
vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({ createAuthenticatedForgeApplication: vi.fn(async () => authenticated) }));
import { DELETE, POST } from "./route.js";

const chain = (result) => {
  const value = { select: vi.fn(), eq: vi.fn(), update: vi.fn(), maybeSingle: vi.fn() };
  Object.values(value).forEach((method) => method.mockReturnValue(value));
  value.maybeSingle.mockResolvedValue(result);
  return value;
};

function photoRequest({ entityType = "unit", entityId = "unit_1", file = new File(["fake"], "photo.jpg", { type: "image/jpeg" }) } = {}) {
  const form = new FormData();
  form.set("entityType", entityType);
  form.set("entityId", entityId);
  form.set("file", file);
  return new Request("https://example.test/api/rental/photo", { method: "POST", body: form });
}

describe("rental photo upload route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads a unit photo and returns a signed URL", async () => {
    from.mockReturnValue(chain({ data: { id: "unit_1" }, error: null }));
    upload.mockResolvedValue({ data: { path: "owner_1/units/unit_1/x.jpg" }, error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.test/photo" }, error: null });

    const response = await POST(photoRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.photoUrl).toBe("https://signed.test/photo");
    expect(from).toHaveBeenCalledWith("rental_units");
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^owner_1\/units\/unit_1\/.+\.jpg$/), expect.any(Uint8Array), { contentType: "image/jpeg", upsert: false });
  });

  it("uploads a tenant photo against the tenants table", async () => {
    from.mockReturnValue(chain({ data: { id: "tenant_1" }, error: null }));
    upload.mockResolvedValue({ data: {}, error: null });
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.test/tenant" }, error: null });

    const response = await POST(photoRequest({ entityType: "tenant", entityId: "tenant_1" }));
    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("rental_tenants");
  });

  it("rejects an unsupported entity type without touching storage", async () => {
    const response = await POST(photoRequest({ entityType: "property" }));
    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects a non-image file", async () => {
    const response = await POST(photoRequest({ file: new File(["fake"], "doc.pdf", { type: "application/pdf" }) }));
    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an oversized file", async () => {
    const big = new File([new Uint8Array(5242881)], "big.jpg", { type: "image/jpeg" });
    const response = await POST(photoRequest({ file: big }));
    expect(response.status).toBe(400);
    expect(upload).not.toHaveBeenCalled();
  });

  it("404s when the unit or tenant does not belong to the owner", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    const response = await POST(photoRequest());
    expect(response.status).toBe(404);
    expect(upload).not.toHaveBeenCalled();
  });

  it("cleans up the uploaded object if the row update fails", async () => {
    const ownershipChain = chain({ data: { id: "unit_1" }, error: null });
    const updateChain = chain({ data: null, error: new Error("update failed") });
    from.mockReturnValueOnce(ownershipChain).mockReturnValueOnce(updateChain);
    upload.mockResolvedValue({ data: {}, error: null });

    const response = await POST(photoRequest());
    expect(response.status).toBe(500);
    expect(remove).toHaveBeenCalled();
  });
});

function deleteRequest(body) {
  return new Request("https://example.test/api/rental/photo", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("rental photo removal route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clears the photo columns and removes the storage object", async () => {
    from.mockReturnValue(chain({ data: { photo_bucket: "rental-photos", photo_object_path: "owner_1/units/unit_1/x.jpg" }, error: null }));
    remove.mockResolvedValue({ data: {}, error: null });

    const response = await DELETE(deleteRequest({ entityType: "unit", entityId: "unit_1" }));
    expect(response.status).toBe(200);
    const [updateChainCall] = from.mock.results;
    expect(updateChainCall.value.update).toHaveBeenCalledWith(expect.objectContaining({ photo_bucket: null, photo_object_path: null }));
    expect(remove).toHaveBeenCalledWith(["owner_1/units/unit_1/x.jpg"]);
  });

  it("rejects an unsupported entity type", async () => {
    const response = await DELETE(deleteRequest({ entityType: "property", entityId: "unit_1" }));
    expect(response.status).toBe(400);
    expect(remove).not.toHaveBeenCalled();
  });

  it("404s when the unit or tenant does not belong to the owner", async () => {
    from.mockReturnValue(chain({ data: null, error: null }));
    const response = await DELETE(deleteRequest({ entityType: "unit", entityId: "unit_1" }));
    expect(response.status).toBe(404);
  });

  it("is a no-op success when there is no photo to remove", async () => {
    from.mockReturnValue(chain({ data: { photo_bucket: null, photo_object_path: null }, error: null }));
    const response = await DELETE(deleteRequest({ entityType: "unit", entityId: "unit_1" }));
    expect(response.status).toBe(200);
    expect(remove).not.toHaveBeenCalled();
  });

  it("still succeeds if storage cleanup fails after the row is cleared", async () => {
    from.mockReturnValue(chain({ data: { photo_bucket: "rental-photos", photo_object_path: "owner_1/units/unit_1/x.jpg" }, error: null }));
    remove.mockResolvedValue({ data: null, error: new Error("storage cleanup failed") });

    const response = await DELETE(deleteRequest({ entityType: "unit", entityId: "unit_1" }));
    expect(response.status).toBe(200);
  });
});
