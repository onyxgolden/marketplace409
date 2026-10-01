import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { buildTenantPaymentLedger } from "@/application/rental/tenantPaymentLedger";
import { loadTenantLedgerData } from "@/application/rental/loadTenantLedgerData";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import {
  resolveStatementRecipient,
  buildTenantStatementEmail,
  buildTenantInvoiceEmail,
  buildStatementEventKey,
  buildInvoiceEventKey,
  statementPayloadFingerprint,
} from "@/domains/rental-tenant/tenantStatementEmail";

export const runtime = "nodejs";

// Owner-triggered tenant statement / invoice email. Rentec parity R2.
//
// Explicit action only: one button press sends one statement or one invoice —
// no bulk, no schedule, no auto-send in this slice. The recipient always comes
// from the owner's own tenant record, never free-form input.
//
// Durability: every attempt is logged in rental_notification_outbox (the same
// table the communications panel reads). The row starts 'queued', flips to
// 'sending' under a guarded update, then 'sent' or 'failed'. A 'failed' row is
// picked up by the existing /api/rental/notifications/deliver retry flow.
// Double-click safety: the event_key is unique and payload-fingerprinted, so
// an identical re-press resolves to the existing row instead of re-sending;
// a changed ledger produces a new key and actually sends.
const MAX_SEND_ATTEMPTS = 3;

function badRequest(message) { return NextResponse.json({ error: message }, { status: 400 }); }

// Same promise the invite flow makes: read-only members cannot trigger
// outbound tenant email.
async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

function newOutboxId() {
  return `rental_notification_${crypto.randomUUID()}`;
}

async function findExistingSend(db, ownerId, eventKey) {
  const { data, error } = await db.from("rental_notification_outbox")
    .select("id, status, attempt_count, max_attempts")
    .eq("owner_id", ownerId).eq("event_key", eventKey).maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function POST(request) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    return badRequest("A JSON body is required.");
  }
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    if (await readOnlyWriteBlocked(authenticated)) {
      return NextResponse.json({ error: "Read-only members cannot email tenant statements." }, { status: 403 });
    }
    const { supabaseClient, effectiveOwnerId } = authenticated;

    const kind = body?.kind;
    if (kind !== "statement" && kind !== "invoice") return badRequest("kind must be \"statement\" or \"invoice\".");
    const tenantId = typeof body?.tenantId === "string" ? body.tenantId.trim() : "";
    if (!tenantId) return badRequest("tenantId is required.");

    let loaded;
    try {
      loaded = await loadTenantLedgerData(supabaseClient, effectiveOwnerId, tenantId);
    } catch (error) {
      if (error?.code === "TENANT_NOT_FOUND") return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
      throw error;
    }
    const { tenant, charges, payments, settlements, leases, leaseMemberships, units,
      rentecImports, credits, creditApplications } = loaded;

    let recipient;
    try {
      recipient = resolveStatementRecipient(tenant);
    } catch {
      return badRequest("The tenant does not have an email address on file, so the statement cannot be sent.");
    }

    const ledger = buildTenantPaymentLedger({
      tenantId: tenant.id, charges, payments, settlements, leases,
      leaseMemberships, units, rentecImports, credits, creditApplications,
    });
    const headerContext = ledger.entries[0] || null;
    const propertyLabel = headerContext?.propertyLabel && !String(headerContext.propertyLabel).startsWith("Unknown")
      ? String(headerContext.propertyLabel) : null;
    const unitLabel = headerContext?.unitLabel || null;
    const asOfDate = new Date().toISOString().slice(0, 10);

    let notificationType;
    let leaseId;
    let eventKey;
    let rendered;
    if (kind === "statement") {
      const tenantLeaseIds = leaseMemberships.filter((m) => m.tenant_id === tenant.id).map((m) => m.lease_id);
      const activeLease = leases.find((lease) => tenantLeaseIds.includes(lease.id) && lease.status === "active");
      leaseId = activeLease?.id || tenantLeaseIds[0] || null;
      if (!leaseId) return NextResponse.json({ error: "The tenant has no lease on file, so there is nothing to state." }, { status: 409 });
      rendered = buildTenantStatementEmail({
        tenantName: tenant.display_name, propertyLabel, unitLabel, asOfDate,
        entries: ledger.entries, balanceCents: ledger.balanceCents,
      });
      notificationType = "statement_emailed";
      eventKey = buildStatementEventKey({ tenantId: tenant.id, asOfDate, payloadFingerprint: statementPayloadFingerprint(rendered) });
    } else {
      const chargeId = typeof body?.chargeId === "string" ? body.chargeId.trim() : "";
      if (!chargeId) return badRequest("chargeId is required for an invoice email.");
      const tenantLeaseIds = new Set(leaseMemberships.filter((m) => m.tenant_id === tenant.id).map((m) => m.lease_id));
      const charge = charges.find((row) => row.id === chargeId && tenantLeaseIds.has(row.lease_id));
      if (!charge || charge.status === "void") {
        return NextResponse.json({ error: "That invoice was not found on this tenant's leases." }, { status: 404 });
      }
      const entry = ledger.entries.find((row) => row.kind === "charge" && String(row.sourceId) === String(chargeId));
      rendered = buildTenantInvoiceEmail({
        tenantName: tenant.display_name, propertyLabel, unitLabel,
        charge: {
          label: entry?.label || null,
          chargeType: charge.charge_type, period: charge.period, dueDate: charge.due_date,
          amountCents: Number(charge.amount_cents || 0), paidCents: Number(charge.paid_amount_cents || 0),
        },
      });
      notificationType = "invoice_emailed";
      leaseId = charge.lease_id;
      eventKey = buildInvoiceEventKey({ chargeId, payloadFingerprint: statementPayloadFingerprint(rendered) });
    }

    // Idempotent claim: an identical press (same payload) resolves to the
    // existing row instead of sending twice.
    const { data: inserted, error: insertError } = await supabaseClient.from("rental_notification_outbox")
      .insert({
        owner_id: effectiveOwnerId, id: newOutboxId(), tenant_id: tenant.id, lease_id: leaseId,
        event_key: eventKey, notification_type: notificationType, recipient,
        subject: rendered.subject, body_text: rendered.bodyText, status: "queued",
      })
      .select("id");
    if (insertError && insertError.code !== "23505") throw insertError;
    let notificationId = inserted?.[0]?.id || null;
    if (!notificationId) {
      const existing = await findExistingSend(supabaseClient, effectiveOwnerId, eventKey);
      if (existing && ["queued", "sending", "sent"].includes(existing.status)) {
        return NextResponse.json({ success: true, alreadySent: true, notificationId: existing.id });
      }
      if (existing && existing.status === "failed" && Number(existing.attempt_count || 0) < Number(existing.max_attempts || MAX_SEND_ATTEMPTS)) {
        const { data: reclaimed, error: reclaimError } = await supabaseClient.from("rental_notification_outbox")
          .update({ status: "queued", failure_message: null })
          .eq("owner_id", effectiveOwnerId).eq("id", existing.id).eq("status", "failed")
          .select("id");
        if (reclaimError) throw reclaimError;
        if (reclaimed?.length === 1) notificationId = existing.id;
        else return NextResponse.json({ success: true, alreadySent: true, notificationId: existing.id });
      } else {
        return NextResponse.json({ success: true, alreadySent: true, notificationId: existing?.id || null });
      }
    }

    // Guarded transition to 'sending' — the loser of a race finds zero rows.
    const { data: claimed, error: claimError } = await supabaseClient.from("rental_notification_outbox")
      .update({ status: "sending", attempt_count: 1, last_attempt_at: new Date().toISOString() })
      .eq("owner_id", effectiveOwnerId).eq("id", notificationId).eq("status", "queued")
      .select("id");
    if (claimError) throw claimError;
    if (!claimed?.length) {
      return NextResponse.json({ success: true, alreadySent: true, notificationId });
    }

    try {
      const sent = await createResendRentalEmailProvider().send({
        id: eventKey,
        senderName: "FORGE Rental Manager",
        senderEmail: process.env.RENTAL_EMAIL_SENDER || "rentals@mail.409marketplace.online",
        recipient, subject: rendered.subject, bodyText: rendered.bodyText,
      });
      const { error: doneError } = await supabaseClient.from("rental_notification_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: sent.messageId })
        .eq("owner_id", effectiveOwnerId).eq("id", notificationId);
      if (doneError) throw doneError;
      return NextResponse.json({ success: true, notificationId, recipient });
    } catch (sendError) {
      console.error("Tenant statement email failed", { tenantId, kind, code: sendError?.name || "unknown" });
      await supabaseClient.from("rental_notification_outbox")
        .update({ status: "failed", failure_message: String(sendError?.message || "Email delivery failed.").slice(0, 500) })
        .eq("owner_id", effectiveOwnerId).eq("id", notificationId);
      return NextResponse.json({ error: "The email could not be sent. It is queued for retry.", notificationId }, { status: 502 });
    }
  } catch (error) {
    console.error("Tenant statement email error", error);
    return NextResponse.json({ error: "Unable to email the statement." }, { status: 500 });
  }
}
