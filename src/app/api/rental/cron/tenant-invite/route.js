import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { buildTenantInviteEmail, buildTenantInviteIdempotencyKey, fingerprintString } from "@/domains/rental-tenant/tenantInviteEmail";

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
      if (!dryRun) await ensureBillingEnabled(db);
      return NextResponse.json({ success: true, action: "already_claimed", tenantId: TENANT_ID, billingEnabled: true, dryRun });
    }

    const email = (tenant.email || "").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email))
      return NextResponse.json({ error: "The tenant does not have a valid email address." }, { status: 422 });

    // One-shot gate: an invite recorded after the go-live cutoff means this run
    // (or a manual send) already delivered it — never send twice.
    if (tenant.invited_at && new Date(tenant.invited_at).toISOString() >= GO_LIVE_CUTOFF) {
      if (!dryRun) await ensureBillingEnabled(db);
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

    await createResendRentalEmailProvider().send({
      id: idempotencyKey,
      senderName: "FORGE Rental Manager",
      senderEmail: process.env.RENTAL_EMAIL_SENDER || "rentals@mail.409marketplace.online",
      recipient: email,
      subject: rendered.subject,
      bodyText: rendered.bodyText,
    });

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
