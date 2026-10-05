import { describe, expect, it, vi } from "vitest";
import {
  listDocuments, uploadDocument, getDocumentUrl, deleteDocument,
} from "./workDocuments.js";

function mockDb(chains = [], storageChains = {}, rpcImpl = null) {
  const queue = [...chains];
  const storage = {
    from: vi.fn((bucket) => {
      const ops = storageChains[bucket] || {};
      return {
        upload: ops.upload || (async () => ({ error: null })),
        remove: ops.remove || (async () => ({ error: null })),
        createSignedUrl: ops.createSignedUrl || (async () => ({ data: { signedUrl: "https://signed.example/x" }, error: null })),
      };
    }),
  };
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
    storage,
    rpc: rpcImpl || vi.fn(async () => ({ data: null, error: null })),
  };
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    is: vi.fn(() => node),
    or: vi.fn(() => node), neq: vi.fn(() => node), limit: vi.fn(() => node),
    insert: vi.fn(() => node), update: vi.fn(() => node), delete: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const FILE = {
  name: "rfi-001.pdf", type: "application/pdf", size: 1024,
  bytes: new Uint8Array([1, 2, 3]),
};
const FIELDS = { name: "RFI-001 form", kind: "template", description: null };

describe("listDocuments", () => {
  it("returns the workspace's current documents", async () => {
    const docs = [{ id: "work_document_1", name: "RFI-001 form" }];
    const db = mockDb([chain({ data: docs, error: null })]);
    const result = await listDocuments(db, "owner_1", {});
    expect(result).toEqual(docs);
    expect(db.from).toHaveBeenCalledWith("forge_work_document_library");
  });
  it("filters by kind when given", async () => {
    const db = mockDb([chain({ data: [], error: null })]);
    await listDocuments(db, "owner_1", { kind: "template" });
    const node = db.from.mock.results[0].value;
    expect(node.eq).toHaveBeenCalledWith("kind", "template");
  });
});

describe("uploadDocument", () => {
  it("uploads bytes and creates the version atomically via RPC", async () => {
    const inserted = { id: "work_document_1", name: "RFI-001 form", version_number: 1, is_current_version: true };
    const rpc = vi.fn(async () => ({ data: inserted, error: null }));
    const db = mockDb([], {}, rpc);
    const result = await uploadDocument(db, "owner_1", "user_1", FILE, FIELDS);
    expect(result.ok).toBe(true);
    expect(result.document).toEqual(inserted);
    expect(db.storage.from).toHaveBeenCalledWith("work-documents");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("forge_work_create_document_version");
    const args = rpc.mock.calls[0][1];
    expect(args.p_owner_id).toBe("owner_1");
    expect(args.p_name).toBe("RFI-001 form");
    expect(args.p_kind).toBe("template");
    expect(args.p_version_of_document_id).toBeNull();
  });
  it("rejects invalid input without touching storage", async () => {
    const db = mockDb([]);
    const result = await uploadDocument(db, "owner_1", "user_1",
      { ...FILE, type: "application/zip" }, FIELDS);
    expect(result.ok).toBe(false);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("versions through the RPC with the predecessor id", async () => {
    const predecessor = { id: "work_document_1", template_source_id: null };
    const inserted = { id: "work_document_2", version_number: 2, is_current_version: true };
    const rpc = vi.fn(async () => ({ data: inserted, error: null }));
    const db = mockDb([chain({ data: predecessor, error: null })], {}, rpc);
    const result = await uploadDocument(db, "owner_1", "user_1", FILE,
      { ...FIELDS, versionOfDocumentId: "work_document_1" });
    expect(result.ok).toBe(true);
    expect(result.document.version_number).toBe(2);
    expect(rpc.mock.calls[0][1].p_version_of_document_id).toBe("work_document_1");
  });
  it("inherits template provenance when versioning a filled copy", async () => {
    const predecessor = { id: "work_document_1", template_source_id: "work_document_9" };
    const inserted = { id: "work_document_2", version_number: 2, template_source_id: "work_document_9" };
    const rpc = vi.fn(async () => ({ data: inserted, error: null }));
    const db = mockDb([
      chain({ data: predecessor, error: null }),
      chain({ data: { id: "work_document_9" }, error: null }), // template exists
    ], {}, rpc);
    const result = await uploadDocument(db, "owner_1", "user_1", FILE,
      { ...FIELDS, kind: "filled_form", versionOfDocumentId: "work_document_1" });
    expect(result.ok).toBe(true);
    expect(rpc.mock.calls[0][1].p_template_source_id).toBe("work_document_9");
  });
  it("an explicit template source overrides the inherited one", async () => {
    const predecessor = { id: "work_document_1", template_source_id: "work_document_9" };
    const rpc = vi.fn(async () => ({ data: { id: "work_document_2" }, error: null }));
    const db = mockDb([
      chain({ data: predecessor, error: null }),
      chain({ data: { id: "work_document_7" }, error: null }), // template exists
    ], {}, rpc);
    await uploadDocument(db, "owner_1", "user_1", FILE,
      { ...FIELDS, versionOfDocumentId: "work_document_1", templateSourceId: "work_document_7" });
    expect(rpc.mock.calls[0][1].p_template_source_id).toBe("work_document_7");
  });
  it("returns a retryable error on a revision race (unique violation)", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: null, error: { code: "23505", message: "duplicate" } }));
    const db = mockDb([], { "work-documents": { remove } }, rpc);
    const result = await uploadDocument(db, "owner_1", "user_1", FILE, FIELDS);
    expect(result.ok).toBe(false);
    expect(result.retryable).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1); // orphaned bytes cleaned up
  });
  it("rejects versioning a missing predecessor", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await uploadDocument(db, "owner_1", "user_1", FILE,
      { ...FIELDS, versionOfDocumentId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/does not exist/);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("rejects a missing template source", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await uploadDocument(db, "owner_1", "user_1", FILE,
      { ...FIELDS, templateSourceId: "nope" });
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/template.*does not exist/);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("removes the uploaded object when the RPC fails", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: null, error: { message: "boom" } }));
    const db = mockDb([], { "work-documents": { remove } }, rpc);
    await expect(uploadDocument(db, "owner_1", "user_1", FILE, FIELDS)).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("getDocumentUrl", () => {
  it("returns a signed URL for a workspace document", async () => {
    const db = mockDb([chain({
      data: { bucket: "work-documents", object_path: "owner_1/x/f.pdf", original_filename: "f.pdf" },
      error: null,
    })]);
    const result = await getDocumentUrl(db, "owner_1", "work_document_1", {});
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://signed.example/x");
  });
  it("reports a missing document", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await getDocumentUrl(db, "owner_1", "nope", {});
    expect(result.ok).toBe(false);
  });
});

describe("deleteDocument", () => {
  it("soft-deletes: the row stays, the file stays, history survives", async () => {
    const updateChain = chain({ data: null, error: null });
    const db = mockDb([
      chain({ data: { id: "work_document_1" }, error: null }),
      updateChain,
    ]);
    const result = await deleteDocument(db, "owner_1", "work_document_1");
    expect(result.ok).toBe(true);
    expect(updateChain.update).toHaveBeenCalledTimes(1);
    const updateArg = updateChain.update.mock.calls[0][0];
    expect(updateArg.deleted_at).toBeTruthy();
    expect(updateArg.is_current_version).toBe(false);
    // Storage file is NOT removed — history is preserved.
    expect(db.storage.from).not.toHaveBeenCalled();
  });
  it("reports a missing document", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await deleteDocument(db, "owner_1", "nope");
    expect(result.ok).toBe(false);
  });
});
