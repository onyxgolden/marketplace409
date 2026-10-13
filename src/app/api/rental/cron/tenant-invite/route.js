import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { buildTenantInviteEmail, buildTenantInviteIdempotencyKey, fingerprintString } from "@/domains/rental-tenant/tenantInviteEmail";
import {
  claimLedgerRow,
  recordLedgerOutcome,
  takeoverLedgerRow,
  chicagoSlotFor,
  SCHEDULE_NAMES,
  LEDGER_STATES,
  isPositiveSendEvidence,
  CLAIM_TAKEOVER_STALE_MINUTES,
  MAX_LEDGER_SEND_ATTEMPTS,
} from "@/application/notifications/scheduledSendLedger";

export const runtime = "nodejs";

// One-shot go-live for Eric Carrillo (308 Paula). Jason's word 2026-09-25:
// make Eric live Saturday 2026-09-26 at 10:00 America/Chicago — Brandy texts
// him in the morning, the tenant portal invite email lands at 10:00.
//
// The run is ordered for safe partial failure: render the email, send it,
// stamp invited_at, and only then enable billing. If the send throws, nothing
// is persisted and billing stays off, so a retry simply tries the whole run
// again. Billing is last because "live" must never be true before the tenant
// can actually get in.
//
// The run is also one-shot by construction: it only sends when no invite has
// been recorded since GO_LIVE_CUTOFF (midnight Central on go-live day). After
// the 10:00 run records invited_at, every later invocation no-ops — so the
// recurring Vercel cron entry cannot double-send if it is not removed
// promptly. Remove the vercel.json entry after the 2026-09-26 run is confirmed.
const OWNER_ID = "e1b22131-9100-4a79-bbe2-b82d43af922e";
const TENANT_ID = "rental_tenant_a5822588-f661-4346-b6cc-f914aa22ffea";
const LEASE_ID = "rental_lease_9530cad2-7457-4bca-8d7c-974cc5d6c1e3";
const GO_LIVE_CUTOFF = "2026-09-26T05:00:00.000Z";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Ledger helpers (receipt-delivery confirmation ledger). Every write is
// gated on !dryRun by the callers. A refire that finds a terminal ledger row
// for (schedule, slot, recipient) reconciles -- it skips the send instead of
// duplicating it.
function ledgerArgs(runId) {
  return {
    scheduleName: SCHEDULE_NAMES.TENANT_INVITE,
    scheduledSlot: chicagoSlotFor(),
    recipientAllowlistId: TENANT_ID,
    runId,
  };
}

async function recordNoOp(db, runId) {
  await claimLedgerRow(db, ledgerArgs(runId));
  await recordLedgerOutcome(db, { ...ledgerArgs(runId), state: LEDGER_STATES.NO_OP });
}

async function ensureBillingEnabled(db) {
  const { error } = await db.from("rental_billing_settings").upsert(
    { owner_id: OWNER_ID, billing_enabled: true, updated_at: new Date().toISOString() },
    { onConflict: "owner_id" }
  );
  if (error) throw error;
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  const asOfDate = todayISODate();
  const runId = `tenant_invite_${randomUUID()}`;

  try {
    const db = createRentalWebhookClient();

    const { data: tenant, error: tenantError } = await db.from("rental_tenants")
      .select("id, display_name, email, status, auth_user_id, invited_at")
      .eq("owner_id", OWNER_ID).eq("id", TENANT_ID).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });

    // Already claimed the portal: nothing to send. Billing is still ensured so
    // the "live" invariant holds either way.
    if (tenant.auth_user_id) {
      if (!dryRun) {
        await ensureBillingEnabled(db);
        await recordNoOp(db, runId);
      }
      return NextResponse.json({ success: true, action: "already_claimed", tenantId: TENANT_ID, billingEnabled: true, dryRun });
    }

    const email = (tenant.email || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email))
      return NextResponse.json({ error: "The tenant does not have a valid email address." }, { status: 422 });

    // One-shot gate: an invite recorded after the go-live cutoff means this run
    // (or a manual send) already delivered it — never send twice.
    if (tenant.invited_at && new Date(tenant.invited_at).toISOString() >= GO_LIVE_CUTOFF) {
      if (!dryRun) {
        await ensureBillingEnabled(db);
        await recordNoOp(db, runId);
      }
      return NextResponse.json({ success: true, action: "already_sent", tenantId: TENANT_ID, billingEnabled: true, dryRun });
    }

    // Lease summary for the email — fetched live so the copy is never stale.
    let leaseSummary = null;
    const { data: link, error: linkError } = await db.from("rental_lease_tenants")
      .select("lease_id").eq("owner_id", OWNER_ID).eq("lease_id", LEASE_ID).eq("tenant_id", TENANT_ID).maybeSingle();
    if (linkError) throw linkError;
    if (link) {
      const { data: lease, error: leaseError } = await db.from("rental_leases")
        .select("unit_id, start_date, monthly_rent_cents").eq("owner_id", OWNER_ID).eq("id", LEASE_ID).maybeSingle();
      if (leaseError) throw leaseError;
      if (lease) {
        const { data: unit, error: unitError } = await db.from("rental_units")
          .select("label").eq("owner_id", OWNER_ID).eq("id", lease.unit_id).maybeSingle();
        if (unitError) throw unitError;
        leaseSummary = {
          unitLabel: unit?.label || "your rental",
          monthlyRentCents: lease.monthly_rent_cents,
          startDate: lease.start_date,
        };
      }
    }

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://marketplace409.vercel.app").replace(/\/$/, "");
    const rendered = buildTenantInviteEmail({
      tenantName: tenant.display_name,
      tenantEmail: email,
      leaseSummary,
      portalUrl: `${siteUrl}/forge/rental/portal`,
    });
    const idempotencyKey = buildTenantInviteIdempotencyKey({
      tenantId: TENANT_ID,
      asOfDate,
      payloadFingerprint: fingerprintString(`${rendered.subject}\n${rendered.bodyText}`),
    });

    if (dryRun) {
      return NextResponse.json({
        success: true, action: "would_send", tenantId: TENANT_ID, recipient: email,
        subject: rendered.subject, leaseSummary, idempotencyKey, dryRun: true,
      });
    }

    // Durable FENCED pre-send claim (confirmation ledger), RDL-001/RDL-002:
    // the claim row is written BEFORE the provider call, and only the run
    // that owns the claim (fresh winner, or atomic takeover of a
    // stale/failed row) may send.
    //   * provider_accepted/delivered are POSITIVE send evidence ->
    //     reconcile: stamp invited_at if the local stamp was lost
    //     (provider-accepted-before-local-stamp), enable billing, report
    //     already_sent. provider_failed is NEVER positive evidence and
    //     never enables billing.
    //   * fresh claimed row held by another run -> defer (409), never send.
    //   * stale claimed / failed-with-attempts-left -> atomic takeover,
    //     then send under the stable identity.
    //   * failed with attempts exhausted -> explicit blocked failure, no
    //     billing, no send.
    //   * missing row after a lost claim -> fail closed, never send.
    let claimedRow = null;
    if (!dryRun) {
      const claim = await claimLedgerRow(db, ledgerArgs(runId));
      if (claim.claimed) {
        claimedRow = claim.row;
      } else if (claim.existing) {
        const existingState = claim.existing.state;
        if (isPositiveSendEvidence(existingState)) {
          const timestamp = new Date().toISOString();
          if (!tenant.invited_at || new Date(tenant.invited_at).toISOString() < GO_LIVE_CUTOFF) {
            const { error: stampError } = await db.from("rental_tenants")
              .update({ invited_at: timestamp, updated_at: timestamp })
              .eq("owner_id", OWNER_ID).eq("id", TENANT_ID);
            if (stampError) throw stampError;
          }
          await ensureBillingEnabled(db);
          return NextResponse.json({
            success: true,
            action: "already_sent",
            tenantId: TENANT_ID,
            billingEnabled: true,
            reconciled: true,
            ledgerState: existingState,
          });
        }
        const takeover = await takeoverLedgerRow(db, {
          ...ledgerArgs(runId),
          staleMinutes: CLAIM_TAKEOVER_STALE_MINUTES,
          maxAttempts: MAX_LEDGER_SEND_ATTEMPTS,
        });
        if (takeover.taken) {
          claimedRow = takeover.row;
        } else {
          const current = takeover.existing;
          if (current && current.state === LEDGER_STATES.CLAIMED) {
            return NextResponse.json(
              { success: false, action: "deferred_claim_held", tenantId: TENANT_ID, billingEnabled: false },
              { status: 409 },
            );
          }
          if (current && current.state === LEDGER_STATES.PROVIDER_FAILED) {
            return NextResponse.json(
              {
                success: false,
                action: "blocked_provider_failed",
                tenantId: TENANT_ID,
                billingEnabled: false,
                ledgerState: current.state,
                sendAttempts: current.send_attempts ?? null,
                failureReason: current.failure_reason ?? null,
              },
              { status: 500 },
            );
          }
          return NextResponse.json(
            { success: false, action: "blocked_ledger", tenantId: TENANT_ID, billingEnabled: false },
            { status: 500 },
          );
        }
      } else {
        return NextResponse.json(
          { success: false, action: "blocked_ledger", tenantId: TENANT_ID, billingEnabled: false },
          { status: 500 },
        );
      }
    }

    let providerMessageId = null;
    try {
      const result = await createResendRentalEmailProvider().send({
        id: idempotencyKey,
        senderName: "FORGE Rental Manager",
        senderEmail: process.env.RENTAL_EMAIL_SENDER || "rentals@mail.409marketplace.online",
        recipient: email,
        subject: rendered.subject,
        bodyText: rendered.bodyText,
      });
      providerMessageId = result?.messageId ?? result?.id ?? null;
    } catch (sendError) {
      if (!dryRun && claimedRow) {
        await recordLedgerOutcome(db, {
          ...ledgerArgs(runId),
          state: LEDGER_STATES.PROVIDER_FAILED,
          failureReason: sendError?.message?.slice(0, 500) || "unknown",
        });
      }
      throw sendError;
    }

    // Provider accepted the send (message id returned -- acceptance, not
    // proof of delivery; 'delivered' is reserved for delivery confirmation).
    if (!dryRun && claimedRow) {
      await recordLedgerOutcome(db, {
        ...ledgerArgs(runId),
        state: LEDGER_STATES.PROVIDER_ACCEPTED,
        providerMessageId,
      });
    }

    const timestamp = new Date().toISOString();
    const { error: updateError } = await db.from("rental_tenants")
      .update({ invited_at: timestamp, updated_at: timestamp })
      .eq("owner_id", OWNER_ID).eq("id", TENANT_ID);
    if (updateError) throw updateError;

    // Billing goes last: only after the invite is sent and recorded.
    await ensureBillingEnabled(db);

    return NextResponse.json({ success: true, action: "sent", tenantId: TENANT_ID, recipient: email, billingEnabled: true });
  } catch (error) {
    console.error("Tenant invite cron failed", { tenantId: TENANT_ID, error: error?.message || "unknown" });
    return NextResponse.json({ error: "The tenant invite run failed." }, { status: 500 });
  }
}
