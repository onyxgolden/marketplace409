import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { resolvePaymentReceiptConfig } from "@/domains/private-financing/paymentReceiptNotifications";
import { resolveRentalNotificationConfig } from "@/domains/owner-notifications/ownerNotificationConfig";

export const runtime = "nodejs";

// Operational preflight — the rollout proof for the three notification lanes
// (personal-loan receipts, rental tenant receipts, rental owner notifications).
// Authenticated and strictly READ-ONLY: it resolves the ACTUAL configured
// allowlist IDs from the environment, maps each allowlisted borrower/tenant
// to its display name, and reports current pending delivery rows — with no
// email-provider calls, no database writes, no email addresses, and no payment
// details anywhere in the response or logs. An allowlisted ID that resolves
// to no record (displayName: null) is a misconfiguration this surfaces.
//
// Invoke manually with the cron secret before any rollout decision. This route
// is deliberately NOT registered in vercel.json and sends nothing.
function maskEmail(email) {
  const text = String(email || "");
  const at = text.indexOf("@");
  if (at <= 0) return null;
  return `${text[0]}***${text.slice(at)}`;
}

async function resolveDisplayNames(db, table, ids, nameColumn) {
  if (ids.length === 0) return [];
  const { data, error } = await db.from(table).select(`id,${nameColumn}`).in("id", ids);
  if (error) throw error;
  const byId = new Map((data || []).map((row) => [row.id, row[nameColumn] ?? null]));
  return ids.map((id) => ({ id, displayName: byId.get(id) ?? null }));
}

async function pendingDeliveryCounts(db, table, { maxAttempts, staleClaimMinutes }) {
  const { data, error } = await db
    .from(table)
    .select("status,attempt_count,last_attempted_at")
    .in("status", ["queued", "failed", "sending"]);
  if (error) throw error;
  const staleCutoff = Date.now() - staleClaimMinutes * 60 * 1000;
  let queued = 0;
  let retryable = 0;
  for (const row of data || []) {
    if (row.status === "queued") {
      queued += 1;
    } else if (
      row.attempt_count < maxAttempts &&
      (row.status === "failed" ||
        (row.status === "sending" &&
          row.last_attempted_at &&
          new Date(row.last_attempted_at).getTime() < staleCutoff))
    ) {
      retryable += 1;
    }
  }
  return { queued, retryable };
}

export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const db = createRentalWebhookClient();
    const pfConfig = resolvePaymentReceiptConfig();
    const rentalConfig = resolveRentalNotificationConfig();

    const [pfBorrowers, rentalTenants, pfPending, tenantPending, ownerPending] = await Promise.all([
      resolveDisplayNames(db, "private_financing_borrowers", pfConfig.allowedBorrowerIds, "full_name"),
      resolveDisplayNames(db, "rental_tenants", rentalConfig.allowedTenantIds, "display_name"),
      pendingDeliveryCounts(db, "private_financing_payment_receipt_deliveries", pfConfig),
      pendingDeliveryCounts(db, "rental_tenant_receipt_deliveries", rentalConfig),
      pendingDeliveryCounts(db, "rental_owner_notifications", rentalConfig),
    ]);

    return NextResponse.json({
      success: true,
      checkedAt: new Date().toISOString(),
      lanes: {
        personalLoan: {
          sendingEnabled: pfConfig.enabled,
          borrowerAllowlist: pfBorrowers,
          ownerAllowlist: pfConfig.allowedOwnerIds.map((id) => ({ id })),
          ownerConfirmationRecipient: maskEmail(pfConfig.recipientEmail),
          pendingDeliveries: pfPending,
        },
        rentalTenant: {
          sendingEnabled: rentalConfig.enabled,
          tenantAllowlist: rentalTenants,
          ownerAllowlist: rentalConfig.allowedOwnerIds.map((id) => ({ id })),
          pendingDeliveries: tenantPending,
        },
        rentalOwner: {
          sendingEnabled: rentalConfig.enabled,
          ownerAllowlist: rentalConfig.allowedOwnerIds.map((id) => ({ id })),
          tenantAllowlist: rentalTenants,
          ownerConfirmationRecipient: maskEmail(rentalConfig.recipientEmail),
          pendingDeliveries: ownerPending,
        },
      },
    });
  } catch (error) {
    console.error("Notification preflight error", error);
    return NextResponse.json({ error: "Unable to run notification preflight." }, { status: 500 });
  }
}
