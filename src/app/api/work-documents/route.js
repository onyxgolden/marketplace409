import {
  listDocuments, uploadDocument, getDocumentUrl, deleteDocument,
} from "@/application/work-management/workDocuments";
import { ok, fail, serverError, workAuth } from "../work-packages/_lib/auth.js";

// GET /api/work-documents?kind=template — list the workspace's library.
export async function GET(request) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const url = new URL(request.url);
    const documentId = url.searchParams.get("documentId");
    if (documentId) {
      // Signed preview/download URL for one document.
      const result = await getDocumentUrl(auth.db, auth.ownerId, documentId, {
        download: url.searchParams.get("action") === "download",
      });
      if (!result.ok) return fail({ error: result.error, httpStatus: 404 });
      return ok({ url: result.url });
    }
    const documents = await listDocuments(auth.db, auth.ownerId, {
      kind: url.searchParams.get("kind") || null,
      includeSuperseded: url.searchParams.get("includeSuperseded") === "true",
    });
    return ok({ documents });
  } catch (error) {
    return serverError("Work documents list error", error);
  }
}

// POST /api/work-documents — multipart upload (file, name, kind, …).
export async function POST(request) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return fail({ error: "A document file is required.", httpStatus: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await uploadDocument(auth.db, auth.ownerId, auth.actor, {
      name: file.name, type: file.type, size: file.size, bytes,
    }, {
      name: String(form.get("name") || "").trim() || file.name,
      kind: String(form.get("kind") || "reference").trim(),
      description: String(form.get("description") || "").trim() || null,
      templateSourceId: String(form.get("templateSourceId") || "").trim() || null,
      versionOfDocumentId: String(form.get("versionOfDocumentId") || "").trim() || null,
    });
    if (!result.ok) {
      const status = result.retryable ? 409 : 400;
      return ok(
        { error: result.errors.join(" "), retryable: result.retryable || false },
        status,
      );
    }
    return ok({ success: true, document: result.document }, 201);
  } catch (error) {
    return serverError("Work document upload error", error);
  }
}

// DELETE /api/work-documents?documentId=… — remove a document and its file.
export async function DELETE(request) {
  try {
    const auth = await workAuth();
    if (auth.error) return auth.error;
    const documentId = new URL(request.url).searchParams.get("documentId");
    if (!documentId) return fail({ error: "documentId is required.", httpStatus: 400 });
    const result = await deleteDocument(auth.db, auth.ownerId, documentId);
    if (!result.ok) return fail({ error: result.error, httpStatus: 404 });
    return ok({ success: true });
  } catch (error) {
    return serverError("Work document delete error", error);
  }
}
