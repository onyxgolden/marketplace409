import { NextResponse } from "next/server";
import { parseHealthDocumentText } from "@/domains/health/parseHealthDocumentText";
import { GoogleCloudVisionOCRAdapter } from "@/infrastructure/ocr/GoogleCloudVisionOCRAdapter";
import { extractNativePdfText } from "@/infrastructure/ocr/extractNativePdfText";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "health-documents";
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const CATEGORIES = new Set(["medication_label", "lab_report", "visit_summary", "imaging", "prescription", "insurance", "authorization", "other"]);
const safe = (value) => String(value || "document").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";

async function extract(bytes, mimeType) {
  if (mimeType === "application/pdf") {
    const native = await extractNativePdfText({ bytes: bytes.slice(0), contentType: mimeType });
    if (!native.requiresOCR) return native;
  }
  return new GoogleCloudVisionOCRAdapter().extractText({ bytes: bytes.slice(0), mimeType });
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    const workspaceId = String(form.get("workspaceId") || "").trim();
    const profileId = String(form.get("profileId") || "").trim();
    const category = String(form.get("category") || "").trim();
    const title = String(form.get("title") || "").trim();
    const documentDate = String(form.get("documentDate") || "").trim() || null;

    if (!file || typeof file.arrayBuffer !== "function" || !workspaceId || !profileId || !title || !CATEGORIES.has(category)) {
      return NextResponse.json({ error: "A person, title, category and document are required." }, { status: 400 });
    }
    if (!TYPES.has(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Use a PDF, JPG or PNG file no larger than 10 MB." }, { status: 400 });
    }

    const [{ data: membership, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
      supabase.from("health_workspace_members").select("workspace_id").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle(),
      supabase.from("health_profiles").select("id").eq("workspace_id", workspaceId).eq("id", profileId).maybeSingle(),
    ]);
    if (membershipError || profileError) throw membershipError || profileError;
    if (!membership || !profile) return NextResponse.json({ error: "Private health profile access is required." }, { status: 403 });

    const id = crypto.randomUUID();
    const objectPath = `${workspaceId}/${profileId}/${id}/${safe(file.name)}`;
    const bytes = await file.arrayBuffer();
    const uploaded = await supabase.storage.from(BUCKET).upload(objectPath, new Uint8Array(bytes.slice(0)), { contentType: file.type, upsert: false });
    if (uploaded.error) throw uploaded.error;

    let extraction;
    let extractionError = null;
    try { extraction = await extract(bytes, file.type); } catch (error) { extractionError = error; }

    const documentInsert = await supabase.from("health_documents").insert({
      id, workspace_id: workspaceId, profile_id: profileId, category, title, document_date: documentDate,
      bucket: BUCKET, object_path: objectPath, original_filename: file.name, mime_type: file.type, byte_size: file.size,
      extraction_method: extraction?.extractionMethod || (extractionError ? "failed" : "pending"),
      extracted_text: extraction?.text || null, review_status: extractionError ? "extraction_failed" : "pending_review", uploaded_by: user.id,
    }).select("id,review_status").single();
    if (documentInsert.error) {
      await supabase.storage.from(BUCKET).remove([objectPath]);
      throw documentInsert.error;
    }

    const signed = await supabase.storage.from(BUCKET).createSignedUrl(objectPath, 10 * 60);
    const sourceUrl = signed.data?.signedUrl || null;

    if (extractionError) return NextResponse.json({ success: true, document: documentInsert.data, sourceUrl, mimeType: file.type, proposal: null, warning: "The source was saved, but its text could not be extracted. Enter its fields manually." });

    const parsed = parseHealthDocumentText({ documentType: category, extractedText: extraction.text });
    const proposalInsert = await supabase.from("health_extraction_proposals").insert({
      workspace_id: workspaceId, profile_id: profileId, document_id: id, proposal_type: parsed.proposalType,
      proposed_data: parsed.fields, parser_version: parsed.parserVersion, created_by: user.id,
    }).select("id,proposal_type,proposed_data,parser_version,status").single();
    if (proposalInsert.error) throw proposalInsert.error;

    return NextResponse.json({ success: true, document: documentInsert.data, sourceUrl, mimeType: file.type, proposal: proposalInsert.data, confidence: parsed.confidence });
  } catch (error) {
    console.error("Health document proposal error", error);
    return NextResponse.json({ error: "Unable to preserve and extract this health document." }, { status: 500 });
  }
}
