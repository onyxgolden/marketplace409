// Slice-7 PDF blockers — controlled drawing intake service tests.
// Storage and the database are mocked (the Supabase-shaped chain mock
// used across the work-management services); these tests prove the
// reserve / upload / verify / finalize order, the idempotent replay,
// and the storage-failure compensation — never a live database.
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  computeSha256,
  intakeObjectPath,
  uploadControlledDrawing,
  stageIfcArtifact,
  listArtifacts,
  getArtifactPreviewUrl,
} from "./drawingIntake.js";

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n%test isometric\n%%EOF\n");
const PDF_SHA = computeSha256(PDF_BYTES);
const OTHER_BYTES = new TextEncoder().encode("%PDF-1.7\n%a different file\n%%EOF\n");
const OTHER_SHA = computeSha256(OTHER_BYTES);

const INPUT = {
  drawingType: "isometric",
  drawingNumber: "W-0005-1",
  lineNumber: '2"-PL-101',
  revisionCode: "0",
  issueDate: "2026-11-13",
  issuerRef: "Drafter A",
  title: "Test isometric",
  pIdDrawingId: "",
  requestId: "req-1",
};
const FILE = { bytes: PDF_BYTES, mimeType: "application/pdf", originalFilename: "W-0005-1.pdf" };

const ARTIFACT_ROW = {
  id: "forge_wpa_1", package_id: "pkg_1", drawing_id: "forge_wdwg_1", revision_id: "forge_wpdrv_1",
  purpose: "ifa_issued", bucket: "controlled-drawings",
  object_path: `owner_1/pkg_1/req-1/${PDF_SHA}.pdf`,
  original_filename: "W-0005-1.pdf", content_sha256: PDF_SHA, content_length: PDF_BYTES.length,
  request_id: "req-1", created_by: "user_9", created_at: "2026-11-13T12:00:00Z",
  retired_at: null, retired_by: null,
};
const DRAWING_ROW = {
  id: "forge_wdwg_1", package_id: "pkg_1", drawing_number: "W-0005-1", drawing_type: "isometric",
  title: "Test isometric", line_number: '2"-PL-101', p_id_drawing_id: null,
  retired_at: null, retired_by: null,
};
const REVISION_ROW = {
  id: "forge_wpdrv_1", package_id: "pkg_1", drawing_id: "forge_wdwg_1", revision_code: "0",
  document_ref: `controlled-drawings:owner_1/pkg_1/req-1/${PDF_SHA}.pdf`,
  content_sha256: PDF_SHA, issued_as: "IFA", issued_at: "2026-11-13T12:00:00Z",
  created_by: "user_9", created_at: "2026-11-13T12:00:00Z", retired_at: null, retired_by: null,
};

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    is: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

function mockDb(chains = [], storageChains = {}, rpcImpl = null) {
  const queue = [...chains];
  const storage = {
    from: vi.fn((bucket) => {
      const ops = storageChains[bucket] || {};
      return {
        upload: ops.upload || (async () => ({ error: null })),
        remove: ops.remove || (async () => ({ error: null })),
        download: ops.download || (async () => ({ data: null, error: { message: "not found" } })),
        createSignedUrl: ops.createSignedUrl
          || (async () => ({ data: { signedUrl: "https://signed.example/controlled.pdf" }, error: null })),
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeSha256 / intakeObjectPath", () => {
  it("hashes the actual bytes and scopes the path under owner/package/request", () => {
    expect(PDF_SHA).toMatch(/^[0-9a-f]{64}$/);
    expect(PDF_SHA).not.toBe(OTHER_SHA);
    expect(intakeObjectPath({ ownerId: "owner_1", packageId: "pkg_1", requestId: "req-1", sha256: PDF_SHA }))
      .toBe(`owner_1/pkg_1/req-1/${PDF_SHA}.pdf`);
  });
});

describe("uploadControlledDrawing", () => {
  it("uploads the bytes first, then finalizes through the intake RPC", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: ARTIFACT_ROW, error: null }));
    const db = mockDb(
      [chain({ data: null, error: null }), chain({ data: DRAWING_ROW, error: null }), chain({ data: REVISION_ROW, error: null })],
      { "controlled-drawings": { upload } },
      rpc,
    );
    const result = await uploadControlledDrawing(db, { ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE });
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.artifact.contentSha256).toBe(PDF_SHA);
    expect(result.artifact.objectPath).toBe(`owner_1/pkg_1/req-1/${PDF_SHA}.pdf`);
    expect(result.drawing.drawingNumber).toBe("W-0005-1");
    expect(result.revision.revisionCode).toBe("0");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe(`owner_1/pkg_1/req-1/${PDF_SHA}.pdf`);
    expect(upload.mock.calls[0][2]).toEqual({ contentType: "application/pdf", upsert: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("forge_wp_drawing_controlled_intake");
    const args = rpc.mock.calls[0][1];
    expect(args.p_owner_id).toBe("owner_1");
    expect(args.p_package_id).toBe("pkg_1");
    expect(args.p_drawing_number).toBe("W-0005-1");
    expect(args.p_content_sha256).toBe(PDF_SHA);
    expect(args.p_request_id).toBe("req-1");
    expect(args.p_line_number).toBe('2"-PL-101');
  });

  it("rejects bad input and non-PDF files without touching storage or the RPC", async () => {
    const db = mockDb([]);
    const bad = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1",
      input: { ...INPUT, drawingType: "sketch" }, file: FILE,
    });
    expect(bad.ok).toBe(false);
    expect(bad.httpStatus).toBe(400);
    const notPdf = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1", input: INPUT,
      file: { bytes: new TextEncoder().encode("hello"), mimeType: "application/pdf" },
    });
    expect(notPdf.ok).toBe(false);
    expect(notPdf.httpStatus).toBe(400);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("replays the original receipt for the same request id + digest, without re-uploading", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: ARTIFACT_ROW, error: null }));
    const db = mockDb(
      [chain({ data: ARTIFACT_ROW, error: null }), chain({ data: DRAWING_ROW, error: null }), chain({ data: REVISION_ROW, error: null })],
      { "controlled-drawings": { upload } },
      rpc,
    );
    const result = await uploadControlledDrawing(db, { ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE });
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(true);
    expect(result.artifact.id).toBe("forge_wpa_1");
    expect(upload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("409s when the same request id is reused for different bytes", async () => {
    const db = mockDb([chain({ data: ARTIFACT_ROW, error: null })]);
    const result = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1", input: INPUT,
      file: { bytes: OTHER_BYTES, mimeType: "application/pdf" },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  // Fix round 1: the request id binds one operation to one semantic
  // target. Same id + same digest is NOT a replay when the operation,
  // package, drawing or metadata differ.
  it("409s a same-id, same-digest replay for a different package", async () => {
    const db = mockDb([chain({ data: { ...ARTIFACT_ROW, package_id: "pkg_2" }, error: null })]);
    const result = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("409s a same-id, same-digest replay for a different drawing number", async () => {
    const db = mockDb([
      chain({ data: ARTIFACT_ROW, error: null }),
      chain({ data: { ...DRAWING_ROW, drawing_number: "W-0005-2" }, error: null }),
      chain({ data: REVISION_ROW, error: null }),
    ]);
    const result = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("409s a same-id, same-digest replay for a different revision code", async () => {
    const db = mockDb([
      chain({ data: ARTIFACT_ROW, error: null }),
      chain({ data: DRAWING_ROW, error: null }),
      chain({ data: { ...REVISION_ROW, revision_code: "1" }, error: null }),
    ]);
    const result = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("409s a same-id, same-digest replay with a changed line number", async () => {
    const db = mockDb([
      chain({ data: ARTIFACT_ROW, error: null }),
      chain({ data: { ...DRAWING_ROW, line_number: '3"-PL-102' }, error: null }),
      chain({ data: REVISION_ROW, error: null }),
    ]);
    const result = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("409s an IFC stage receipt reused as an intake (operation mismatch)", async () => {
    const db = mockDb([chain({ data: { ...ARTIFACT_ROW, purpose: "ifc_candidate" }, error: null })]);
    const result = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("409s when the receipt's drawing cannot be loaded (fail closed)", async () => {
    const db = mockDb([
      chain({ data: ARTIFACT_ROW, error: null }),
      chain({ data: null, error: null }),
      chain({ data: null, error: null }),
    ]);
    const result = await uploadControlledDrawing(db, {
      ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("removes the uploaded object when the RPC fails (compensation)", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }));
    const db = mockDb(
      [chain({ data: null, error: null })],
      { "controlled-drawings": { remove } },
      rpc,
    );
    const result = await uploadControlledDrawing(db, { ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(remove).toHaveBeenCalledWith([`owner_1/pkg_1/req-1/${PDF_SHA}.pdf`]);
  });

  it("503s when the artifacts table does not exist yet (migration not applied)", async () => {
    const db = mockDb([chain({ data: null, error: { code: "42P01", message: 'relation "forge_wp_drawing_artifacts" does not exist' } })]);
    const result = await uploadControlledDrawing(db, { ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
    expect(db.storage.from).not.toHaveBeenCalled();
  });

  it("verifies a pre-existing object at the same path instead of failing", async () => {
    const upload = vi.fn(async () => ({ error: { statusCode: 409, message: "already exists" } }));
    const download = vi.fn(async () => ({ data: PDF_BYTES, error: null }));
    const rpc = vi.fn(async () => ({ data: ARTIFACT_ROW, error: null }));
    const db = mockDb(
      [chain({ data: null, error: null }), chain({ data: DRAWING_ROW, error: null }), chain({ data: REVISION_ROW, error: null })],
      { "controlled-drawings": { upload, download } },
      rpc,
    );
    const result = await uploadControlledDrawing(db, { ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE });
    expect(result.ok).toBe(true);
    expect(download).toHaveBeenCalledWith(`owner_1/pkg_1/req-1/${PDF_SHA}.pdf`);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("409s when a pre-existing object at the same path holds different bytes", async () => {
    const upload = vi.fn(async () => ({ error: { statusCode: 409, message: "already exists" } }));
    const download = vi.fn(async () => ({ data: OTHER_BYTES, error: null }));
    const rpc = vi.fn(async () => ({ data: ARTIFACT_ROW, error: null }));
    const db = mockDb(
      [chain({ data: null, error: null })],
      { "controlled-drawings": { upload, download } },
      rpc,
    );
    const result = await uploadControlledDrawing(db, { ownerId: "owner_1", packageId: "pkg_1", input: INPUT, file: FILE });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("stageIfcArtifact", () => {
  const STAGE_ROW = { ...ARTIFACT_ROW, purpose: "ifc_candidate", revision_id: null, request_id: "req-stage" };

  it("stages bytes with no revision created, through the stage RPC", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    // The RPC row for a fresh stage names the path this call just
    // uploaded (owner/package/request/sha) — nothing to clean up.
    const rpc = vi.fn(async () => ({
      data: { ...STAGE_ROW, object_path: `owner_1/pkg_1/req-stage/${PDF_SHA}.pdf` },
      error: null,
    }));
    const db = mockDb([chain({ data: null, error: null })], { "controlled-drawings": { remove } }, rpc);
    const result = await stageIfcArtifact(db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1",
      input: { requestId: "req-stage" }, file: FILE,
    });
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(false);
    expect(result.artifact.purpose).toBe("ifc_candidate");
    expect(result.artifact.revisionId).toBeNull();
    expect(rpc.mock.calls[0][0]).toBe("forge_wp_drawing_ifc_stage");
    expect(rpc.mock.calls[0][1].p_drawing_id).toBe("forge_wdwg_1");
    expect(rpc.mock.calls[0][1].p_content_sha256).toBe(PDF_SHA);
    expect(remove).not.toHaveBeenCalled();
  });

  // Fix round 2: when the stage RPC deduplicates to a pre-existing
  // candidate, the object this call just uploaded is unreferenced —
  // remove it and return the existing candidate as a replay.
  it("removes the newly uploaded object when the stage RPC deduplicates to a pre-existing candidate", async () => {
    const existingPath = `owner_1/pkg_1/req-first/${PDF_SHA}.pdf`;
    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({
      data: { ...STAGE_ROW, id: "forge_wpa_old", object_path: existingPath, request_id: "req-first" },
      error: null,
    }));
    const db = mockDb([chain({ data: null, error: null })], { "controlled-drawings": { remove } }, rpc);
    const result = await stageIfcArtifact(db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1",
      input: { requestId: "req-stage2" }, file: FILE,
    });
    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(true);
    expect(result.artifact.id).toBe("forge_wpa_old");
    expect(result.artifact.objectPath).toBe(existingPath);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([`owner_1/pkg_1/req-stage2/${PDF_SHA}.pdf`]);
  });

  it("replays the same staged bytes and 409s the same-digest-as-IFA guard from the RPC", async () => {
    const replayDb = mockDb([chain({ data: STAGE_ROW, error: null })]);
    const replayed = await stageIfcArtifact(replayDb, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1",
      input: { requestId: "req-stage" }, file: FILE,
    });
    expect(replayed.ok).toBe(true);
    expect(replayed.replayed).toBe(true);

    const remove = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({ data: null, error: { message: "WPP7_IFC_SAME_AS_IFA" } }));
    const db = mockDb(
      [chain({ data: null, error: null })],
      { "controlled-drawings": { remove } },
      rpc,
    );
    const same = await stageIfcArtifact(db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1",
      input: { requestId: "req-other" }, file: FILE,
    });
    expect(same.ok).toBe(false);
    expect(same.httpStatus).toBe(409);
    expect(remove).toHaveBeenCalled();
  });

  // Fix round 1: a stage receipt binds one operation to one package
  // and drawing. Same id + same digest is NOT a replay across
  // packages, drawings, or operations.
  it("409s a same-id, same-digest stage replay for a different package", async () => {
    const db = mockDb([chain({ data: { ...STAGE_ROW, package_id: "pkg_2" }, error: null })]);
    const result = await stageIfcArtifact(db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1",
      input: { requestId: "req-stage" }, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("409s a same-id, same-digest stage replay for a different drawing", async () => {
    const db = mockDb([chain({ data: { ...STAGE_ROW, drawing_id: "forge_wdwg_2" }, error: null })]);
    const result = await stageIfcArtifact(db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1",
      input: { requestId: "req-stage" }, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("409s an IFA intake receipt reused as a stage (operation mismatch)", async () => {
    const db = mockDb([chain({ data: { ...STAGE_ROW, purpose: "ifa_issued" }, error: null })]);
    const result = await stageIfcArtifact(db, {
      ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1",
      input: { requestId: "req-stage" }, file: FILE,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(409);
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("listArtifacts", () => {
  it("404s a drawing from another package and reads empty when the table is missing", async () => {
    const other = await listArtifacts(
      mockDb([chain({ data: { ...DRAWING_ROW, package_id: "pkg_9" }, error: null })]),
      { ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1" },
    );
    expect(other.ok).toBe(false);
    expect(other.httpStatus).toBe(404);

    const missing = await listArtifacts(
      mockDb([
        chain({ data: DRAWING_ROW, error: null }),
        chain({ data: null, error: { code: "42P01", message: "forge_wp_drawing_artifacts does not exist" } }),
      ]),
      { ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1" },
    );
    expect(missing.ok).toBe(true);
    expect(missing.artifacts).toEqual([]);
  });

  it("lists the drawing's artifacts newest first", async () => {
    const result = await listArtifacts(
      mockDb([
        chain({ data: DRAWING_ROW, error: null }),
        chain({ data: [ARTIFACT_ROW], error: null }),
      ]),
      { ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1" },
    );
    expect(result.ok).toBe(true);
    expect(result.drawing.drawingNumber).toBe("W-0005-1");
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].purpose).toBe("ifa_issued");
  });
});

describe("getArtifactPreviewUrl", () => {
  it("mints a signed URL for an artifact in the package", async () => {
    const result = await getArtifactPreviewUrl(
      mockDb([chain({ data: ARTIFACT_ROW, error: null })]),
      { ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1", artifactId: "forge_wpa_1" },
    );
    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://signed.example/controlled.pdf");
    expect(result.expiresInSeconds).toBe(3600);
  });

  it("404s an artifact from another package or drawing", async () => {
    const result = await getArtifactPreviewUrl(
      mockDb([chain({ data: { ...ARTIFACT_ROW, package_id: "pkg_9" }, error: null })]),
      { ownerId: "owner_1", packageId: "pkg_1", drawingId: "forge_wdwg_1", artifactId: "forge_wpa_1" },
    );
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(404);
  });
});
