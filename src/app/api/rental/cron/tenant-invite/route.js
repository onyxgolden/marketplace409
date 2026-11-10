import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { buildTenantInviteEmail, buildTenantInviteIdempotencyKey, fingerprintString } from "@/domains/rental-tenant/tenantInviteEmail";
import {
  claimLedgerRow,
  recordLedgerOutcome,
  chicagoSlotFor,
  SCHEDULE_NAMES,
  LEDGER_STATES,
  isPositiveSendEvidence,
} from "@/application/notifications/scheduledSendLedger";

export const runtime = "nodejs";

// Generalized tenant-invite sweep (replaces the 2026-09-26 Eric Carrillo
// one-shot, which hardcoded one tenant, one lease, and a go-live cutoff and
// has been a no-op ever since). DISABLED by owner order 2026-11-09 — the
// gate in GET returns action:"disabled" unless TENANT_INVITE_ENABLED=true,
// so no invite goes out to anyone until the owner says otherwise. When
// enabled, every run invites exactly the tenants who are ready and have
// never been invited:
//
//   * on an ACTIVE lease (draft/preparing/cancelled leases never invite),
//   * with a valid email on the tenant record,
//   * with invited_at still null (an invite already recorded is never resent),
//   * with no portal claim yet (auth_user_id null — claimed tenants need
//     no invite).
//
// And nobody else. In particular this route never enables billing and never
// touches any tenant outside that set — billing activation is a separate
// owner decision, not an invite side effect.
//
// Safety, per tenant (fail closed, never double-send):
//   * the confirmation ledger claims (schedule, Chicago-date slot, tenant)
//     BEFORE the provider call, with the provider key + payload digest
//     persisted on the claim; only the claiming run sends.
//   * a run that finds positive send evidence (provider_accepted /
//     delivered) reconciles the invited_at stamp instead of resending.
//   * any other ledger outcome (claim held by a live run, provider_failed)
//     skips that tenant for this run — the slot rotates daily (Chicago
//     date), so the next day's run retries it under a fresh claim. No
//     takeover dance: a skipped tenant is a delayed tenant, never a
//     double-sent one.
//   * the per-tenant-per-day provider idempotency key is the backstop: a
//     retried request resolves to the single original email.
// Invites remain manually sendable any time via the panel's invite button
// (sendTenantInvite), which also covers tenants whose invited_at was
// stamped by the old creation default without any email ever going out.

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Stamp invited_at after a send. Returns the PostgREST error (or null).
// Identical to the manual panel path (sendTenantInvite in
// src/app/api/rental/_actions/tenants.js): same three columns, same
// owner_id + id filter — the panel path is the proven-working copy of
// this write.
async function stampTenantInvite(db, tenant, timestamp) {
  const { error } = await db.from("rental_tenants")
    .update({ invited_at: timestamp, status: "invited", updated_at: timestamp })
    .eq("owner_id", tenant.owner_id).eq("id", tenant.id);
  return error ?? null;
}

// Cross-slot dedup: the ledger's per-slot claim stops a resend within one
// day, but a tenant whose stamp never lands is a fresh candidate under
// every new slot. Positive send evidence for this tenant in ANY slot
// means "already sent" — reconcile (retry the stamp) instead of sending
// a second email. Throws on a ledger read error: the ledger is the safety
// mechanism, so an unreadable ledger fails closed.
async function findPriorTenantInviteSend(db, tenantId) {
  const { data, error } = await db.from("scheduled_send_ledger")
    .select("id,state,scheduled_slot")
    .eq("schedule_name", SCHEDULE_NAMES.TENANT_INVITE)
    .eq("recipient_allowlist_id", tenantId)
    .in("state", [LEDGER_STATES.PROVIDER_ACCEPTED, LEDGER_STATES.DELIVERED])
    .order("scheduled_slot", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";

  // OWNER HALT (Jason, 2026-11-09): the automated tenant-invite sweep is
  // OFF. No invite email goes out to anyone — not to tenants who already
  // received one, not to tenants who never got one. The sweep sent
  // unsolicited invites on its own (nobody pressed send); the owner
  // stopped it. Re-enable only on the owner's explicit word, by setting
  // TENANT_INVITE_ENABLED=true in the deployment environment — no code
  // change needed. The manual panel invite (sendTenantInvite) is
  // unaffected: a tenant who asks to switch can still be invited by hand.
  // The disabled response is success:true with failed:0 so the GitHub
  // workflow run goes green and no watchdog refire is triggered.
  if (process.env.TENANT_INVITE_ENABLED !== "true") {
    return NextResponse.json({ success: true, action: "disabled", sent: [], reconciled: [], wouldSend: [],
      skipped: { noEmail: 0, noActiveLease: 0, ledgerDeferred: 0, failed: 0 }, failures: [], failed: 0, dryRun });
  }

  const asOfDate = todayISODate();
  const runId = `tenant_invite_${randomUUID()}`;
  // RDL-002B: freeze the scheduled slot once per run (a run straddling a
  // Chicago-midnight boundary must not claim one slot and reconcile
  // another).
  const slot = chicagoSlotFor();

  try {
    const db = createRentalWebhookClient();

    // Candidates: never invited, never claimed. Email validity and lease
    // activity are checked below (Supabase cannot regex-filter email).
    const { data: candidates, error: tenantError } = await db.from("rental_tenants")
      .select("id, owner_id, display_name, email, status, auth_user_id, invited_at")
      .is("invited_at", null).is("auth_user_id", null);
    if (tenantError) throw tenantError;

    const sent = [];
    const reconciled = [];
    const wouldSend = [];
    const skipped = { noEmail: 0, noActiveLease: 0, ledgerDeferred: 0, failed: 0 };
    const failures = [];
    let ledgerClaims = 0;

    const candidateList = candidates || [];

    const candidateIds = candidateList.map((tenant) => tenant.id);
    const { data: memberships, error: membershipError } = candidateIds.length
      ? await db.from("rental_lease_tenants")
        .select("tenant_id, lease_id").in("tenant_id", candidateIds)
      : { data: [], error: null };
    if (membershipError) throw membershipError;
    const leaseIds = [...new Set((memberships || []).map((row) => row.lease_id).filter(Boolean))];
    const { data: leaseRows, error: leaseError } = leaseIds.length
      ? await db.from("rental_leases").select("id, unit_id, start_date, monthly_rent_cents, status").in("id", leaseIds)
      : { data: [], error: null };
    if (leaseError) throw leaseError;
    const activeLeasesById = new Map((leaseRows || []).filter((lease) => lease.status === "active").map((lease) => [lease.id, lease]));
    const activeLeaseIdByTenant = new Map();
    for (const row of memberships || []) {
      if (activeLeasesById.has(row.lease_id) && !activeLeaseIdByTenant.has(row.tenant_id)) {
        activeLeaseIdByTenant.set(row.tenant_id, row.lease_id);
      }
    }
    const activeUnitIds = [...new Set([...activeLeaseIdByTenant.values()].map((leaseId) => activeLeasesById.get(leaseId)?.unit_id).filter(Boolean))];
    const { data: unitRows, error: unitError } = activeUnitIds.length
      ? await db.from("rental_units").select("id, label").in("id", activeUnitIds)
      : { data: [], error: null };
    if (unitError) throw unitError;
    const unitLabelById = new Map((unitRows || []).map((unit) => [unit.id, unit.label]));

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://marketplace409.vercel.app").replace(/\/$/, "");

    for (const tenant of candidateList) {
      const email = (tenant.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) { skipped.noEmail += 1; continue; }
      const leaseId = activeLeaseIdByTenant.get(tenant.id);
      if (!leaseId) { skipped.noActiveLease += 1; continue; }
      const lease = activeLeasesById.get(leaseId);
      const leaseSummary = lease ? {
        unitLabel: unitLabelById.get(lease.unit_id) || "your rental",
        monthlyRentCents: lease.monthly_rent_cents,
        startDate: lease.start_date,
      } : null;

      // Already sent on an earlier day (stamp lost): never send twice.
      // Reconcile the stamp instead; if the stamp still fails, skip.
      const priorSend = await findPriorTenantInviteSend(db, tenant.id);
      if (priorSend) {
        const timestamp = new Date().toISOString();
        const stampError = await stampTenantInvite(db, tenant, timestamp);
        if (stampError) {
          skipped.ledgerDeferred += 1;
          failures.push({ tenantId: tenant.id, reason: `invite stamp failed: ${stampError.message ?? "unknown"} (${stampError.code ?? "no-code"})` });
        } else {
          reconciled.push(tenant.id);
        }
        continue;
      }

      const rendered = buildTenantInviteEmail({
        tenantName: tenant.display_name,
        tenantEmail: email,
        leaseSummary,
        portalUrl: `${siteUrl}/forge/rental/portal`,
      });
      const payloadFingerprint = fingerprintString(`${rendered.subject}\n${rendered.bodyText}`);
      const idempotencyKey = buildTenantInviteIdempotencyKey({
        tenantId: tenant.id,
        asOfDate,
        payloadFingerprint,
      });

      if (dryRun) {
        wouldSend.push({ tenantId: tenant.id, recipient: email, subject: rendered.subject, leaseSummary, idempotencyKey });
        continue;
      }

      // Durable fenced pre-send claim (confirmation ledger), RDL-001/RDL-002:
      // only the run that owns the claim may send.
      let claimedRow = null;
      try {
        const claim = await claimLedgerRow(db, {
          scheduleName: SCHEDULE_NAMES.TENANT_INVITE,
          scheduledSlot: slot,
          recipientAllowlistId: tenant.id,
          runId,
          providerRequestKey: idempotencyKey,
          payloadDigest: payloadFingerprint,
        });
        ledgerClaims += 1;
        if (claim.claimed) {
          claimedRow = claim.row;
        } else if (claim.existing && isPositiveSendEvidence(claim.existing.state)) {
          // Provider accepted before the local stamp was lost: reconcile
          // the stamp, never resend.
          const timestamp = new Date().toISOString();
          const stampError = await stampTenantInvite(db, tenant, timestamp);
          if (stampError) {
            skipped.ledgerDeferred += 1;
            failures.push({ tenantId: tenant.id, reason: `invite stamp failed: ${stampError.message ?? "unknown"} (${stampError.code ?? "no-code"})` });
            continue;
          }
          reconciled.push(tenant.id);
          continue;
        } else {
          // Claim held by a live run, failed, or missing: fail closed for
          // this slot. Tomorrow's slot retries.
          skipped.ledgerDeferred += 1;
          continue;
        }
      } catch (claimError) {
        skipped.ledgerDeferred += 1;
        failures.push({ tenantId: tenant.id, reason: claimError?.message || "ledger claim failed" });
        continue;
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
        await recordLedgerOutcome(db, {
          scheduleName: SCHEDULE_NAMES.TENANT_INVITE,
          scheduledSlot: slot,
          recipientAllowlistId: tenant.id,
          runId,
          state: LEDGER_STATES.PROVIDER_FAILED,
          failureReason: sendError?.message?.slice(0, 500) || "unknown",
        }).catch(() => {});
        skipped.failed += 1;
        failures.push({ tenantId: tenant.id, reason: sendError?.message || "provider send failed" });
        continue;
      }

      // Provider accepted the send (message id returned -- acceptance, not
      // proof of delivery; 'delivered' is reserved for delivery confirmation).
      await recordLedgerOutcome(db, {
        scheduleName: SCHEDULE_NAMES.TENANT_INVITE,
        scheduledSlot: slot,
        recipientAllowlistId: tenant.id,
        runId,
        state: LEDGER_STATES.PROVIDER_ACCEPTED,
        providerMessageId,
      }).catch(() => {});

      const timestamp = new Date().toISOString();
      const updateError = await stampTenantInvite(db, tenant, timestamp);
      if (updateError) {
        // The email is already sent: a stamp failure must never fail the
        // run (and must never block the remaining tenants). Record it with
        // the PostgREST code so the next failure is diagnosable from the
        // workflow step log, and keep going.
        skipped.failed += 1;
        failures.push({ tenantId: tenant.id, reason: `invite stamp failed: ${updateError.message ?? "unknown"} (${updateError.code ?? "no-code"})` });
        continue;
      }
      sent.push(tenant.id);
    }

    // Run-level evidence: if the sweep wrote no per-recipient ledger rows
    // (nothing to send, or the whole run skipped pre-claim), record a
    // synthetic '_sweep' no_op row so the watchdog can distinguish "ran,
    // nothing to do" from "never ran". Evidence only — a failure here
    // must never fail the run.
    if (!dryRun && ledgerClaims === 0) {
      try {
        const sweepKey = {
          scheduleName: SCHEDULE_NAMES.TENANT_INVITE,
          scheduledSlot: slot,
          recipientAllowlistId: "_sweep",
          runId,
        };
        await claimLedgerRow(db, sweepKey);
        await recordLedgerOutcome(db, { ...sweepKey, state: LEDGER_STATES.NO_OP, failureReason: "no_recipients_to_send" });
      } catch {
        // Evidence write failed; the sends (or skips) above still stand.
      }
    }

    return NextResponse.json({ success: true, action: dryRun ? "would_send" : (sent.length || reconciled.length ? "sent" : "no_candidates"), sent, reconciled, wouldSend, skipped, failures, failed: failures.length, dryRun });
  } catch (error) {
    console.error("Tenant invite cron failed", { error: error?.message || "unknown" });
    return NextResponse.json({ error: "The tenant invite run failed." }, { status: 500 });
  }
}
