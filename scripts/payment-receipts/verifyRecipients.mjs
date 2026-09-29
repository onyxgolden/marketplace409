// Read-only pre-activation recipient verification for the payment-receipt
// rollout (personal-loan PR #462, rental PR #463, dry-run tooling #464).
//
// Resolves each CONFIGURED allowlist id (PF_RECEIPT_BORROWER_IDS,
// RENTAL_NOTIFICATION_TENANT_IDS, OWNER_PAYMENT_NOTIFICATION_OWNER_IDS)
// against the real database and prints the actual name/email/property
// attached to it, so a human can visually confirm the right people are
// configured BEFORE Jason authorizes activation — this is the "authenticated
// read-only preflight against the actual deployment" the PR #464 round-4
// review asked for before enabling sending.
//
// GUARANTEES (see verifyRecipients.test.mjs):
//   - Every database call is a `.select(...)` — never insert/update/upsert/delete.
//   - No email provider is constructed or called.
//   - No environment variable is ever mutated; only read.
// This script cannot itself send anything or write anything, by construction.
//
// Run in the REAL deployed/configured environment (needs real
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and the real allowlist
// env vars set — this repo/sandbox has neither):
//   node scripts/payment-receipts/verifyRecipients.mjs

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  resolveOwnerNotificationConfig,
  resolveRentalNotificationConfig,
} from "../../src/domains/owner-notifications/ownerNotificationConfig.js";
import { resolvePaymentReceiptConfig } from "../../src/domains/private-financing/paymentReceiptNotifications.js";
import { resolvePropertyLabel } from "../../src/application/rental/queueOwnerPaymentNotification.js";

// Same env vars and client options as the established CLI-script pattern
// (scripts/scheduling/verifyCpmEngineAgainstRealProjects.mjs,
// scripts/engineering-brain/persistence/syncManifestToSupabase.mjs) — a plain
// service-role client, not the cookie-based Next.js SSR client, since this
// runs outside any request context.
export function createSupabaseServiceClient({
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  if (!url || !serviceRoleKey) {
    throw new Error("Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** One private-financing borrower's real name/email for a configured id. Read-only. */
export async function lookupBorrower(db, borrowerId) {
  const { data, error } = await db
    .from("private_financing_borrowers")
    .select("id, full_name, email")
    .eq("id", borrowerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * One rental tenant's real name/email/property for a configured id, plus
 * every lease they're attached to (a tenant can have more than one over
 * time) so a human sees the full picture, not a silently-picked "current"
 * one. Read-only; reuses resolvePropertyLabel exactly as the real send path
 * does, so this can't drift from what the actual notification would say.
 */
export async function lookupTenant(db, tenantId) {
  const { data: tenant, error: tenantError } = await db
    .from("rental_tenants")
    .select("id, display_name, email, status, owner_id")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) return null;

  const { data: leaseLinks, error: leaseLinkError } = await db
    .from("rental_lease_tenants")
    .select("lease_id")
    .eq("tenant_id", tenantId);
  if (leaseLinkError) throw leaseLinkError;

  const leases = [];
  for (const { lease_id: leaseId } of leaseLinks || []) {
    const { data: lease, error: leaseError } = await db
      .from("rental_leases")
      .select("id, status")
      .eq("id", leaseId)
      .maybeSingle();
    if (leaseError) throw leaseError;
    const propertyLabel = await resolvePropertyLabel(db, { ownerId: tenant.owner_id, leaseId });
    leases.push({ leaseId, status: lease?.status ?? null, propertyLabel });
  }
  return { ...tenant, leases };
}

/**
 * Full report: every id on every configured allowlist, resolved to a real
 * name/email/property (or explicitly flagged as NOT FOUND — a dangling id is
 * exactly the kind of mistake this exists to catch before activation).
 * Pure given an injected db client — see the test file for the no-write
 * assertion this enables.
 */
export async function buildRecipientVerificationReport(db, env = process.env) {
  const ownerConfig = resolveOwnerNotificationConfig(env);
  const rentalConfig = resolveRentalNotificationConfig(env);
  const receiptConfig = resolvePaymentReceiptConfig(env);

  const borrowers = [];
  for (const id of receiptConfig.allowedBorrowerIds) {
    const borrower = await lookupBorrower(db, id);
    borrowers.push({ id, found: Boolean(borrower), ...borrower });
  }

  const tenants = [];
  for (const id of rentalConfig.allowedTenantIds) {
    const tenant = await lookupTenant(db, id);
    tenants.push({ id, found: Boolean(tenant), ...tenant });
  }

  return {
    ownerRecipientEmail: ownerConfig.recipientEmail,
    ownerAllowlistIds: ownerConfig.allowedOwnerIds,
    borrowerAllowlist: borrowers,
    tenantAllowlist: tenants,
    sendingEnabled: {
      ownerPaymentNotifications: ownerConfig.enabled,
      // resolveRentalNotificationConfig/resolvePaymentReceiptConfig both
      // extend the owner config, so this is the same `enabled` flag —
      // stated per-lane so a reader never has to go check that.
      rentalTenantReceipts: rentalConfig.enabled,
      personalLoanReceipts: receiptConfig.enabled,
    },
  };
}

function formatReport(report) {
  const lines = [];
  lines.push("PAYMENT RECEIPT RECIPIENT VERIFICATION — READ ONLY, NOTHING SENT, NOTHING WRITTEN");
  lines.push("=".repeat(78));
  lines.push(`Owner-notification recipient (Brandy): ${report.ownerRecipientEmail}`);
  lines.push(`Owner allowlist ids: ${report.ownerAllowlistIds.join(", ") || "(EMPTY — fails closed, nothing queues)"}`);
  lines.push("");
  lines.push(`Sending enabled — owner: ${report.sendingEnabled.ownerPaymentNotifications}, rental tenant: ${report.sendingEnabled.rentalTenantReceipts}, personal loan: ${report.sendingEnabled.personalLoanReceipts}`);
  lines.push("");
  lines.push(`Borrower allowlist (${report.borrowerAllowlist.length} configured):`);
  if (report.borrowerAllowlist.length === 0) lines.push("  (EMPTY — fails closed, no borrower receipts will queue)");
  for (const b of report.borrowerAllowlist) {
    lines.push(b.found
      ? `  ${b.id} -> ${b.full_name || "(no name on file)"} <${b.email || "NO EMAIL ON FILE"}>`
      : `  ${b.id} -> NOT FOUND IN private_financing_borrowers — dangling id, will never queue but should be fixed`);
  }
  lines.push("");
  lines.push(`Tenant allowlist (${report.tenantAllowlist.length} configured):`);
  if (report.tenantAllowlist.length === 0) lines.push("  (EMPTY — fails closed, no tenant receipts or owner confirmations will queue)");
  for (const t of report.tenantAllowlist) {
    if (!t.found) {
      lines.push(`  ${t.id} -> NOT FOUND IN rental_tenants — dangling id, will never queue but should be fixed`);
      continue;
    }
    const properties = t.leases.length
      ? t.leases.map((l) => `${l.propertyLabel || "(no property label)"} [lease ${l.leaseId}, ${l.status}]`).join("; ")
      : "(no leases on file)";
    lines.push(`  ${t.id} -> ${t.display_name || "(no name on file)"} <${t.email || "NO EMAIL ON FILE"}> — ${properties}`);
  }
  return lines.join("\n");
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const db = createSupabaseServiceClient();
  const report = await buildRecipientVerificationReport(db);
  process.stdout.write(`${formatReport(report)}\n`);
}
