import { NextResponse } from "next/server";
import { createAuthenticatedForgeApplication } from "@/lib/supabase/createAuthenticatedForgeApplication";
import { extractNativePdfText } from "@/infrastructure/ocr/extractNativePdfText";
import { GoogleCloudVisionOCRAdapter } from "@/infrastructure/ocr/GoogleCloudVisionOCRAdapter";

const BUCKET = "rental-documents";
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain"]);
const CATEGORIES = new Set([
  "lease", "addendum", "notice", "inspection", "receipt", "other",
  "survey_plat", "deed", "title_policy", "insurance_policy", "tax_document", "appraisal", "permit", "warranty", "hoa_document",
]);
const DOCUMENT_COLUMNS = "owner_id, id, lease_id, property_id, category, title, description, document_date, expires_at, "
  + "bucket, object_path, original_filename, mime_type, byte_size, tenant_visible, published_at, "
  + "extracted_text, version_of_document_id, version_number, is_current_version, created_by, updated_by, "
  + "created_at, updated_at, deleted_at";
const safe = (value) => value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
const DOCUMENT_ID_PATTERN = /^rental_document_[0-9a-f-]+$/i;
const validDocumentId = (value) => typeof value === "string" && DOCUMENT_ID_PATTERN.test(value);

function expirationStatus(expiresAt, today = new Date().toISOString().slice(0, 10)) {
  if (!expiresAt) return null;
  if (expiresAt < today) return "expired";
  const thirtyDaysOut = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
  return expiresAt <= thirtyDaysOut ? "expiring_soon" : "current";
}

async function requireLandlord(authenticated) {
  const { data: tenant, error } = await authenticated.supabaseClient
    .from("rental_tenants").select("id").eq("auth_user_id", authenticated.user.id).maybeSingle();
  if (error) throw error;
  return !tenant;
}

async function recordAudit(authenticated, { documentId, action, actorRole, detail = {} }) {
  const { error } = await authenticated.supabaseClient.from("rental_document_audit_log").insert({
    owner_id: authenticated.user.id, document_id: documentId, action,
    actor_id: authenticated.user.id, actor_role: actorRole, detail,
  });
  if (error) throw error;
}

export async function GET(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const url = new URL(request.url);

    const documentId = url.searchParams.get("documentId");
    const action = url.searchParams.get("action");
    if (documentId && (action === "preview" || action === "download")) {
      const { data: document, error } = await authenticated.supabaseClient.from("rental_documents")
        .select("id, bucket, object_path").eq("id", documentId).is("deleted_at", null).maybeSingle();
      if (error) throw error;
      if (!document) return NextResponse.json({ error: "Document not found." }, { status: 404 });
      const isLandlord = await requireLandlord(authenticated);
      const signed = await authenticated.supabaseClient.storage.from(document.bucket)
        .createSignedUrl(document.object_path, 600, action === "download" ? { download: true } : undefined);
      if (signed.error) throw signed.error;
      await recordAudit(authenticated, {
        documentId, action: "downloaded", actorRole: isLandlord ? "owner" : "tenant", detail: { mode: action },
      });
      return NextResponse.json({ success: true, url: signed.data.signedUrl });
    }

    const versionsOf = url.searchParams.get("versionsOf");
    if (versionsOf) {
      if (!validDocumentId(versionsOf)) return NextResponse.json({ error: "A valid document is required." }, { status: 400 });
      const { data, error } = await authenticated.supabaseClient.from("rental_documents")
        .select(DOCUMENT_COLUMNS).or(`id.eq.${versionsOf},version_of_document_id.eq.${versionsOf}`)
        .is("deleted_at", null).order("version_number", { ascending: false });
      if (error) throw error;
      return NextResponse.json({ success: true, versions: data || [] });
    }

    const auditFor = url.searchParams.get("auditFor");
    if (auditFor) {
      if (!validDocumentId(auditFor)) return NextResponse.json({ error: "A valid document is required." }, { status: 400 });
      const { data: family, error: familyError } = await authenticated.supabaseClient.from("rental_documents")
        .select("id").or(`id.eq.${auditFor},version_of_document_id.eq.${auditFor}`);
      if (familyError) throw familyError;
      const ids = (family || []).map((row) => row.id);
      if (ids.length === 0) return NextResponse.json({ success: true, auditLog: [] });
      const { data, error } = await authenticated.supabaseClient.from("rental_document_audit_log")
        .select("id, document_id, action, actor_id, actor_role, detail, created_at")
        .in("document_id", ids).order("created_at", { ascending: false });
      if (error) throw error;
      return NextResponse.json({ success: true, auditLog: data || [] });
    }

    let query = authenticated.supabaseClient.from("rental_documents").select(DOCUMENT_COLUMNS)
      .is("deleted_at", null).eq("is_current_version", true).order("created_at", { ascending: false });
    const propertyId = url.searchParams.get("propertyId");
    const leaseId = url.searchParams.get("leaseId");
    const category = url.searchParams.get("category");
    const q = url.searchParams.get("q");
    if (propertyId) query = query.eq("property_id", propertyId);
    if (leaseId) query = query.eq("lease_id", leaseId);
    if (category) query = query.eq("category", category);
    if (q && q.trim()) query = query.textSearch("search_vector", q.trim(), { type: "websearch", config: "english" });

    const [{ data, error }, { data: preparations, error: preparationError }, { data: versions, error: versionError }] = await Promise.all([
      query,
      authenticated.supabaseClient.from("rental_lease_preparations").select("id, lease_id, title, status, current_version, approved_version, approved_at").order("updated_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_lease_preparation_versions").select("preparation_id, version_number, terms, change_summary, created_at").order("version_number", { ascending: false }),
    ]);
    if (error || preparationError || versionError) throw error || preparationError || versionError;

    const documentIds = (data || []).map((document) => document.id);
    const acknowledgementsResult = documentIds.length
      ? await authenticated.supabaseClient.from("rental_document_acknowledgements")
          .select("document_id, tenant_id, acknowledged_at, acknowledgement_version").in("document_id", documentIds)
      : { data: [], error: null };
    if (acknowledgementsResult.error) throw acknowledgementsResult.error;

    const documents = (data || []).map((document) => ({
      ...document,
      expiration_status: expirationStatus(document.expires_at),
      acknowledgements: (acknowledgementsResult.data || []).filter((row) => row.document_id === document.id),
    }));
    const leasePreparations = (preparations || []).map((preparation) => ({
      ...preparation, versions: (versions || []).filter((version) => version.preparation_id === preparation.id),
    }));
    return NextResponse.json({ success: true, documents, leasePreparations });
  } catch (error) {
    console.error("Rental document query error", error);
    return NextResponse.json({ error: "Unable to load rental documents." }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();

    if (body?.operation === "acknowledge-document") {
      if (typeof body.documentId !== "string" || body.documentId.trim() === "") {
        return NextResponse.json({ error: "A supported document acknowledgement is required." }, { status: 400 });
      }
      const { data, error } = await authenticated.supabaseClient.rpc("acknowledge_rental_document", { p_document_id: body.documentId.trim() });
      if (error) throw error;
      return NextResponse.json({ success: true, acknowledgement: data });
    }

    if (body?.operation === "edit-metadata") {
      if (!(await requireLandlord(authenticated))) return NextResponse.json({ error: "Only a landlord can edit rental documents." }, { status: 403 });
      const documentId = String(body?.documentId || "").trim();
      if (!documentId) return NextResponse.json({ error: "A document is required." }, { status: 400 });
      const { data: existing, error: existingError } = await authenticated.supabaseClient.from("rental_documents")
        .select("id, category").eq("id", documentId).is("deleted_at", null).maybeSingle();
      if (existingError) throw existingError;
      if (!existing) return NextResponse.json({ error: "Document not found." }, { status: 404 });

      const updates = { updated_by: authenticated.user.id, updated_at: new Date().toISOString() };
      if (body.title !== undefined) updates.title = String(body.title).trim();
      if (body.description !== undefined) updates.description = String(body.description || "").trim() || null;
      if (body.documentDate !== undefined) updates.document_date = body.documentDate || null;
      if (body.expiresAt !== undefined) updates.expires_at = body.expiresAt || null;
      if (body.category !== undefined) {
        if (!CATEGORIES.has(body.category)) return NextResponse.json({ error: "Unsupported document category." }, { status: 400 });
        updates.category = body.category;
      }
      const { error } = await authenticated.supabaseClient.from("rental_documents").update(updates).eq("id", documentId);
      if (error) throw error;
      await recordAudit(authenticated, {
        documentId, action: updates.category && updates.category !== existing.category ? "category_changed" : "edited",
        actorRole: "owner", detail: updates,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "An unsupported document operation was requested." }, { status: 400 });
  } catch (error) {
    console.error("Rental document update error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update the rental document." }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    if (!(await requireLandlord(authenticated))) return NextResponse.json({ error: "Only a landlord can remove rental documents." }, { status: 403 });
    const documentId = new URL(request.url).searchParams.get("documentId");
    if (!documentId) return NextResponse.json({ error: "A document is required." }, { status: 400 });

    // Soft delete only -- the storage object and every prior version are preserved unchanged.
    const { data, error } = await authenticated.supabaseClient.from("rental_documents")
      .update({ deleted_at: new Date().toISOString(), updated_by: authenticated.user.id })
      .eq("id", documentId).is("deleted_at", null).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Document not found." }, { status: 404 });
    await recordAudit(authenticated, { documentId, action: "deleted", actorRole: "owner" });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Rental document delete error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to remove the rental document." }, { status: 500 });
  }
}

async function extractDocumentText({ bytes, mimeType, textContent }) {
  try {
    if (mimeType === "text/plain") return { text: textContent, extractionMethod: "native_text" };
    if (mimeType === "application/pdf") {
      const native = await extractNativePdfText({ bytes, contentType: mimeType });
      if (!native.requiresOCR) return { text: native.text, extractionMethod: native.extractionMethod };
    }
    const ocr = await new GoogleCloudVisionOCRAdapter().extractText({ bytes, mimeType });
    return { text: ocr.text, extractionMethod: ocr.extractionMethod };
  } catch (error) {
    // Extraction is best-effort: search indexing is a value-add, not a reason to fail an upload.
    console.warn("Rental document text extraction failed", error);
    return { text: null, extractionMethod: null };
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedForgeApplication();
    if (authenticated.response) return authenticated.response;
    if (!(await requireLandlord(authenticated))) return NextResponse.json({ error: "Only a landlord can publish rental documents." }, { status: 403 });

    const form = await request.formData();
    const file = form.get("file");
    const leaseId = String(form.get("leaseId") || "").trim() || null;
    const propertyId = String(form.get("propertyId") || "").trim() || null;
    const title = String(form.get("title") || "").trim();
    const category = String(form.get("category") || "").trim();
    const description = String(form.get("description") || "").trim() || null;
    const documentDate = String(form.get("documentDate") || "").trim() || null;
    const expiresAt = String(form.get("expiresAt") || "").trim() || null;
    const versionOfDocumentId = String(form.get("versionOfDocumentId") || "").trim() || null;

    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "A document file is required." }, { status: 400 });
    if (!leaseId && !propertyId) return NextResponse.json({ error: "A property or lease is required." }, { status: 400 });
    if (!title || !CATEGORIES.has(category)) return NextResponse.json({ error: "Title and a supported category are required." }, { status: 400 });
    if (!TYPES.has(file.type) || file.size > 10485760) return NextResponse.json({ error: "Use a PDF, JPG, PNG, or text file no larger than 10 MB." }, { status: 400 });

    if (propertyId) {
      const { data: unit, error: unitError } = await authenticated.supabaseClient.from("rental_units")
        .select("id").eq("owner_id", authenticated.user.id).eq("property_id", propertyId).maybeSingle();
      if (unitError) throw unitError;
      if (!unit) return NextResponse.json({ error: "This property does not exist in Rental Manager for this owner." }, { status: 400 });
    }

    let versionNumber = 1;
    let rootId = null;
    if (versionOfDocumentId) {
      const { data: predecessor, error: predecessorError } = await authenticated.supabaseClient.from("rental_documents")
        .select("id, version_of_document_id, version_number").eq("id", versionOfDocumentId).is("deleted_at", null).maybeSingle();
      if (predecessorError) throw predecessorError;
      if (!predecessor) return NextResponse.json({ error: "The document to version does not exist." }, { status: 400 });
      rootId = predecessor.version_of_document_id || predecessor.id;
      const { data: latest, error: latestError } = await authenticated.supabaseClient.from("rental_documents")
        .select("version_number").or(`id.eq.${rootId},version_of_document_id.eq.${rootId}`)
        .order("version_number", { ascending: false }).limit(1).maybeSingle();
      if (latestError) throw latestError;
      versionNumber = (latest?.version_number || predecessor.version_number || 1) + 1;
    }

    const id = `rental_document_${crypto.randomUUID()}`;
    const objectPath = `${authenticated.user.id}/${leaseId || `property/${safe(propertyId)}`}/${id}/${safe(file.name)}`;
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const upload = await authenticated.supabaseClient.storage.from(BUCKET).upload(objectPath, fileBytes, { contentType: file.type, upsert: false });
    if (upload.error) throw upload.error;

    const extraction = await extractDocumentText({
      bytes: fileBytes, mimeType: file.type,
      textContent: file.type === "text/plain" ? new TextDecoder().decode(fileBytes) : null,
    });

    const visible = leaseId ? form.get("tenantVisible") === "true" : false;
    const now = new Date().toISOString();
    const inserted = await authenticated.supabaseClient.from("rental_documents").insert({
      owner_id: authenticated.user.id, id, lease_id: leaseId, property_id: propertyId,
      category, title, description, document_date: documentDate, expires_at: expiresAt,
      bucket: BUCKET, object_path: objectPath, original_filename: file.name, mime_type: file.type, byte_size: file.size,
      tenant_visible: visible, published_at: visible ? now : null,
      extracted_text: extraction.text, version_of_document_id: rootId, version_number: versionNumber, is_current_version: true,
      created_by: authenticated.user.id, updated_by: authenticated.user.id, updated_at: now,
    }).select("id, title, tenant_visible").single();
    if (inserted.error) { await authenticated.supabaseClient.storage.from(BUCKET).remove([objectPath]); throw inserted.error; }

    if (rootId) {
      // Flip every OTHER row in the family, not just the specific predecessor the caller selected
      // -- if that predecessor wasn't already the current version (e.g. the caller versioned an
      // older entry), the row that actually was current would otherwise stay marked current too,
      // leaving two "current" versions in the same family.
      const { error: supersedeError } = await authenticated.supabaseClient.from("rental_documents")
        .update({ is_current_version: false })
        .or(`id.eq.${rootId},version_of_document_id.eq.${rootId}`)
        .neq("id", id);
      if (supersedeError) throw supersedeError;
    }

    await recordAudit(authenticated, {
      documentId: id, action: rootId ? "versioned" : "uploaded", actorRole: "owner",
      detail: { title, category, versionNumber, extractionMethod: extraction.extractionMethod },
    });

    return NextResponse.json({ success: true, document: inserted.data });
  } catch (error) {
    console.error("Rental document upload error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to upload the rental document." }, { status: 500 });
  }
}
