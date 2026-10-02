import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { isOwnerOrActiveCoOwner } from "@/lib/supabase/isOwnerOrActiveCoOwner";
import { renderMessageTemplate } from "@/domains/rental-messaging/messageTemplates";
import { resolveLetterTemplateContext } from "@/domains/rental-mailing/letterContext";
import { saveLetterDocumentCopy } from "@/domains/rental-mailing/letterDocuments";
import {
  validateCreateBatchInput,
  summarizeBatchLetters,
} from "@/domains/rental-mailing/mailingLetters";

export const runtime = "nodejs";

// Rentec parity R20 — Mailing Manager collection route.
//
// GET  → batches with per-status letter counts (readable by every workspace
//         member; reading the queue is not a write).
// POST → create one batch: one rendered letter per tenant, queued for
//         mailing. Letters are NEVER sent through a provider here — the
//         owner prints them or mails them at the post office and records
//         tracking numbers manually. Provider send is hard-gated in
//         /api/rental/mailing/provider (see mailProvider.js).
//
// All-or-nothing on addresses: if any selected tenant has no recipient
// address (and no override was given), the whole batch is rejected with 422
// naming those tenants — a half-mailed batch would be worse than none.

function rowToBatch(row, letters = []) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    summary: summarizeBatchLetters(letters),
  };
}

function rowToLetter(row) {
  return {
    id: row.id,
    batchId: row.batch_id,
    templateId: row.template_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    recipientAddress: row.recipient_address,
    returnAddress: row.return_address,
    subject: row.subject,
    body: row.body,
    letterDate: row.letter_date,
    status: row.status,
    trackingNumber: row.tracking_number,
    mailedAt: row.mailed_at,
    deliveredAt: row.delivered_at,
    documentId: row.document_id,
    createdAt: row.created_at,
  };
}

async function ownerOnlyWriteBlocked(authenticated) {
  return !(await isOwnerOrActiveCoOwner({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  }));
}

export async function GET(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  try {
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const { data: batches, error: batchError } = await supabaseClient
      .from("rental_mail_batches")
      .select("id, name, created_by, created_at, updated_at")
      .eq("owner_id", effectiveOwnerId)
      .order("created_at", { ascending: false });
    if (batchError) throw batchError;
    const { data: letters, error: letterError } = await supabaseClient
      .from("rental_mail_letters")
      .select("id, batch_id, status")
      .eq("owner_id", effectiveOwnerId);
    if (letterError) throw letterError;
    const byBatch = new Map();
    for (const letter of letters || []) {
      const list = byBatch.get(letter.batch_id) || [];
      list.push(letter);
      byBatch.set(letter.batch_id, list);
    }
    return NextResponse.json({
      success: true,
      batches: (batches || []).map((row) => rowToBatch(row, byBatch.get(row.id) || [])),
    });
  } catch (error) {
    console.error("Mailing batches load error", error);
    return NextResponse.json({ error: "Unable to load mailing batches." }, { status: 500 });
  }
}

export async function POST(request) {
  const authenticated = await createAuthenticatedRentalManagerApplication();
  if (authenticated.response) return authenticated.response;
  if (await ownerOnlyWriteBlocked(authenticated)) {
    return NextResponse.json({ error: "Only the owner or co-owner can compose mailings." }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  try {
    const { supabaseClient, effectiveOwnerId } = authenticated;
    const validated = validateCreateBatchInput(body);
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    const { name, templateId, tenantIds, returnAddress, recipientAddresses } = validated.clean;

    const { data: template, error: templateError } = await supabaseClient
      .from("rental_message_templates")
      .select("id, name, kind, audience, subject, body")
      .eq("owner_id", effectiveOwnerId)
      .eq("id", templateId)
      .maybeSingle();
    if (templateError) throw templateError;
    if (!template) return NextResponse.json({ error: "The letter template was not found." }, { status: 404 });
    if (template.kind !== "mailing") {
      return NextResponse.json({ error: "That template is not a mailing template — pick one from the Mailing kind." }, { status: 400 });
    }

    const { data: tenantRows, error: tenantError } = await supabaseClient
      .from("rental_tenants")
      .select("id, display_name")
      .eq("owner_id", effectiveOwnerId)
      .in("id", tenantIds);
    if (tenantError) throw tenantError;
    const tenantById = new Map((tenantRows || []).map((row) => [row.id, row]));
    const unknownIds = tenantIds.filter((id) => !tenantById.has(id));
    if (unknownIds.length) {
      return NextResponse.json({ error: `${unknownIds.length} selected tenant${unknownIds.length === 1 ? " was" : "s were"} not found.` }, { status: 404 });
    }

    // Resolve + render every letter first. Any tenant without a recipient
    // address rejects the whole batch so the owner can type one in.
    const drafts = [];
    const addressless = [];
    for (const tenantId of tenantIds) {
      const tenant = tenantById.get(tenantId);
      const { fields, leaseId } = await resolveLetterTemplateContext({
        supabaseClient,
        ownerId: effectiveOwnerId,
        tenantId,
      });
      if (recipientAddresses[tenantId]) fields.tenant_address = recipientAddresses[tenantId];
      if (returnAddress) fields.owner_return_address = returnAddress;
      const renderedBody = renderMessageTemplate(template.body, fields);
      const renderedSubject = template.subject ? renderMessageTemplate(template.subject, fields) : null;
      const missing = new Set([...renderedBody.missing, ...(renderedSubject?.missing || [])]);
      const unknown = new Set([...renderedBody.unknown, ...(renderedSubject?.unknown || [])]);
      const recipientAddress = fields.tenant_address;
      if (!recipientAddress) addressless.push(tenant.display_name);
      drafts.push({
        tenantId,
        leaseId,
        tenantName: tenant.display_name,
        recipientAddress: recipientAddress || "",
        subject: renderedSubject ? renderedSubject.text : null,
        body: renderedBody.text,
        missingFields: [...missing],
        unknownFields: [...unknown],
      });
    }
    if (addressless.length) {
      return NextResponse.json({
        error: `${addressless.join(", ")} ${addressless.length === 1 ? "has" : "have"} no mailing address on file — type one in for ${addressless.length === 1 ? "them" : "each"} and try again.`,
      }, { status: 422 });
    }

    const batchId = `rental_mail_batch_${crypto.randomUUID()}`;
    const { data: batchRow, error: batchError } = await supabaseClient
      .from("rental_mail_batches")
      .insert({
        owner_id: effectiveOwnerId,
        id: batchId,
        name,
        created_by: authenticated.user.id,
      })
      .select("id, name, created_by, created_at, updated_at")
      .single();
    if (batchError) throw batchError;

    const today = new Date().toISOString().slice(0, 10);
    const letterRows = drafts.map((draft) => ({
      owner_id: effectiveOwnerId,
      id: `rental_mail_letter_${crypto.randomUUID()}`,
      batch_id: batchId,
      template_id: templateId,
      tenant_id: draft.tenantId,
      lease_id: draft.leaseId,
      tenant_name: draft.tenantName,
      recipient_address: draft.recipientAddress,
      return_address: returnAddress || null,
      subject: draft.subject,
      body: draft.body,
      letter_date: today,
      status: "queued",
      created_by: authenticated.user.id,
    }));
    const { data: inserted, error: insertError } = await supabaseClient
      .from("rental_mail_letters")
      .insert(letterRows)
      .select("id, batch_id, template_id, tenant_id, tenant_name, recipient_address, return_address, subject, body, letter_date, status, tracking_number, mailed_at, delivered_at, document_id, created_at");
    if (insertError) throw insertError;

    // File-library copies are best-effort: a failed copy never fails the
    // batch — the body snapshot on each letter row is the paper trail.
    const withDocuments = [];
    for (const row of inserted || []) {
      const draft = drafts.find((item) => item.tenantId === row.tenant_id);
      const documentId = await saveLetterDocumentCopy({
        supabaseClient,
        ownerId: effectiveOwnerId,
        letter: {
          ...row,
          tenant_name: row.tenant_name,
          recipient_address: row.recipient_address,
          return_address: row.return_address,
          created_by: authenticated.user.id,
        },
        leaseId: draft?.leaseId || null,
      });
      if (documentId) {
        await supabaseClient.from("rental_mail_letters")
          .update({ document_id: documentId, updated_at: new Date().toISOString() })
          .eq("owner_id", effectiveOwnerId)
          .eq("id", row.id);
        withDocuments.push({ ...row, document_id: documentId });
      } else {
        withDocuments.push(row);
      }
    }

    const letters = withDocuments.map(rowToLetter);
    return NextResponse.json({
      success: true,
      batch: { ...rowToBatch(batchRow, letters.map((letter) => ({ status: letter.status }))), letters },
      note: "Letters are queued — print them or mail them at the post office. No provider is connected, so nothing was sent electronically.",
    }, { status: 201 });
  } catch (error) {
    console.error("Mailing batch create error", error);
    return NextResponse.json({ error: "Unable to queue the mailing batch." }, { status: 500 });
  }
}
