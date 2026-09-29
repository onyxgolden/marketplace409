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

const PREFLIGHT_PAGE_SIZE = 500;
const PREFLIGHT_MAX_PAGES = 20;

// Bounded pagination for the eligibility census. PostgREST silently caps a
// plain .select(), so page deterministically over (owner_id, id) and verify
// the fetched rows against an exact count. A truncated or drifted census is
// never presented as complete — the caller surfaces complete:false instead.
export async function fetchPendingDeliveryRows(
  db,
  table,
  columns,
  { pageSize = PREFLIGHT_PAGE_SIZE, maxPages = PREFLIGHT_MAX_PAGES } = {},
) {
  const selectColumns = `status,attempt_count,last_attempted_at,${columns}`;
  const { count, error: countError } = await db
    .from(table)
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "failed", "sending"]);
  if (countError) throw countError;

  const rows = [];
  let complete = true;
  for (let page = 0; ; page += 1) {
    const from = page * pageSize;
    const { data, error } = await db
      .from(table)
      .select(selectColumns)
      .in("status", ["queued", "failed", "sending"])
      .order("owner_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    if (page + 1 >= maxPages) {
      complete = false; // bound hit with a full page — more rows may exist
      break;
    }
  }
  // A missing or invalid exact count means the census cannot be verified —
  // never report complete without a trustworthy count.
  const countValid = Number.isInteger(count) && count >= 0;
  if (complete && (!countValid || rows.length !== count)) complete = false;
  return { rows, complete };
}

async function pendingDeliveryGroups(db, table, { columns, isEligible, describeExcluded, maxAttempts, staleClaimMinutes }) {
  const { rows, complete } = await fetchPendingDeliveryRows(db, table, columns);
  const thresholds = { maxAttempts, staleClaimMinutes };
  const groups = {
    eligible: { queued: 0, retryable: 0 },
    excluded: { queued: 0, retryable: 0, recipientIds: [] },
    complete,
  };
  const excludedIds = new Set();
  for (const row of rows) {
    const bucket = classifyPendingRow(row, thresholds);
    if (!bucket) continue;
    if (isEligible(row)) {
      groups.eligible[bucket] += 1;
    } else {
      groups.excluded[bucket] += 1;
      excludedIds.add(describeExcluded(row));
    }
  }
  groups.excluded.recipientIds = [...excludedIds].slice(0, 25);
  return groups;
}

function classifyPendingRow(row, config) {
  if (row.status === "queued") return "queued";
  if (row.attempt_count >= config.maxAttempts) return null;
  if (row.status === "failed") return "retryable";
  if (
    row.status === "sending" &&
    row.last_attempted_at &&
    Date.now() - new Date(row.last_attempted_at).getTime() > config.staleClaimMinutes * 60 * 1000
  )
    return "retryable";
  return null;
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
      pendingDeliveryGroups(db, "private_financing_payment_receipt_deliveries", {
        columns: "owner_id,borrower_id",
        maxAttempts: pfConfig.maxAttempts,
        staleClaimMinutes: pfConfig.staleClaimMinutes,
        // Both delivery paths gate on the owner allowlist as well as the
        // borrower/tenant allowlist — the census must apply the same gates.
        isEligible: (row) =>
          pfConfig.allowedOwnerIds.includes(row.owner_id) &&
          pfConfig.allowedBorrowerIds.includes(row.borrower_id),
        describeExcluded: (row) => `owner:${row.owner_id ?? "unknown"} borrower:${row.borrower_id ?? "unknown"}`,
      }),
      pendingDeliveryGroups(db, "rental_tenant_receipt_deliveries", {
        columns: "owner_id,tenant_id",
        maxAttempts: rentalConfig.maxAttempts,
        staleClaimMinutes: rentalConfig.staleClaimMinutes,
        isEligible: (row) =>
          rentalConfig.allowedOwnerIds.includes(row.owner_id) &&
          rentalConfig.allowedTenantIds.includes(row.tenant_id),
        describeExcluded: (row) => `owner:${row.owner_id ?? "unknown"} tenant:${row.tenant_id ?? "unknown"}`,
      }),
      pendingDeliveryGroups(db, "rental_owner_notifications", {
        columns: "owner_id,tenant_id",
        maxAttempts: rentalConfig.maxAttempts,
        staleClaimMinutes: rentalConfig.staleClaimMinutes,
        // The owner lane is gated on BOTH allowlists: an excluded owner or an
        // excluded tenant keeps the notification from ever being delivered.
        isEligible: (row) =>
          rentalConfig.allowedOwnerIds.includes(row.owner_id) &&
          rentalConfig.allowedTenantIds.includes(row.tenant_id),
        describeExcluded: (row) => `owner:${row.owner_id ?? "unknown"} tenant:${row.tenant_id ?? "unknown"}`,
      }),
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
