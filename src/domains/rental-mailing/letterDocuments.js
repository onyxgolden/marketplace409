// Rentec parity R20 — file-library copy of a composed letter.
//
// The compliance paper trail has two halves: the rendered body is snapshotted
// on the letter row itself, and this helper saves a second copy into the
// file library (rental_documents, category "notice") so the letter shows up
// in the tenant's Documents surface alongside leases and other notices.
//
// Best-effort by design: a failed upload never fails the batch — the route
// logs it and leaves letter.document_id NULL, and the letter body snapshot
// remains the authoritative copy. A copy is skipped entirely when the tenant
// has no lease (rental_documents.lease_id is NOT NULL).

import { formatLetterForFile } from "./mailingLetters";

const BUCKET = "rental-documents";
const safe = (value) => String(value || "").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "letter";

export async function saveLetterDocumentCopy({ supabaseClient, ownerId, letter, leaseId }) {
  if (!leaseId) return null; // file-library copies are lease-scoped
  try {
    const text = formatLetterForFile({
      subject: letter.subject,
      body: letter.body,
      tenantName: letter.tenant_name,
      tenantAddress: letter.recipient_address,
      returnAddress: letter.return_address,
      letterDate: letter.letter_date || null,
    });
    const filename = `certified-letter-${safe(letter.tenant_name)}.txt`;
    const objectPath = `${ownerId}/mailing/${letter.batch_id || "single"}/${letter.id}/${filename}`;
    const bytes = new TextEncoder().encode(text);
    const upload = await supabaseClient.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: "text/plain",
      upsert: false,
    });
    if (upload.error) throw upload.error;
    const id = `rental_document_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const inserted = await supabaseClient.from("rental_documents").insert({
      owner_id: ownerId,
      id,
      lease_id: leaseId,
      category: "notice",
      title: `Certified letter — ${letter.tenant_name}`,
      description: "Composed in the Mailing Manager. Print or mail manually; provider send is not connected.",
      document_date: now.slice(0, 10),
      bucket: BUCKET,
      object_path: objectPath,
      original_filename: filename,
      mime_type: "text/plain",
      byte_size: bytes.length,
      tenant_visible: false,
      extracted_text: text.slice(0, 20000),
      version_number: 1,
      is_current_version: true,
      created_by: letter.created_by || null,
      updated_by: letter.created_by || null,
      updated_at: now,
    }).select("id").single();
    if (inserted.error) {
      await supabaseClient.storage.from(BUCKET).remove([objectPath]);
      throw inserted.error;
    }
    return inserted.data.id;
  } catch (error) {
    console.error("Mailing letter file-library copy failed", { letterId: letter.id, name: error?.name || "Error" });
    return null;
  }
}
