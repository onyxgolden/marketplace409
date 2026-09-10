import { NextResponse } from "next/server";
import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { planReminderRun } from "@/domains/private-financing/reminderRunPlanner";

export const runtime = "nodejs";

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

// Loads every account this cron needs to evaluate today: active private_financing_accounts, each
// with its full event/component/terms-version history (mapEventRowsForReplay/replayEvents require
// full history, not just the current version -- see persistedRowMapping.js), its active borrower
// memberships joined to borrower identity (email/name), and any reminder-delivery rows already
// recorded for it (so planReminderRun can recognize "already sent" without a second round-trip).
async function loadAccountsForReminderRun(db) {
  const { data: accounts, error: accountsError } = await db
    .from("private_financing_accounts")
    .select("owner_id, id, status")
    .eq("status", "active");
  if (accountsError) throw accountsError;
  if (!accounts || accounts.length === 0) return [];

  const loaded = [];
  for (const account of accounts) {
    const [eventsResult, componentsResult, termsResult, membershipsResult, deliveriesResult] = await Promise.all([
      db.from("private_financing_events").select("*").eq("owner_id", account.owner_id).eq("account_id", account.id),
      db.from("private_financing_components").select("*").eq("owner_id", account.owner_id).eq("account_id", account.id),
      db.from("private_financing_account_terms_versions").select("*").eq("owner_id", account.owner_id).eq("account_id", account.id),
      db
        .from("private_financing_account_borrowers")
        .select("borrower_id, status, private_financing_borrowers(id, email, full_name)")
        .eq("owner_id", account.owner_id)
        .eq("account_id", account.id)
        .eq("status", "active"),
      db
        .from("private_financing_payment_reminder_deliveries")
        .select("borrower_id, due_date, reminder_type, status")
        .eq("owner_id", account.owner_id)
        .eq("account_id", account.id),
    ]);
    if (eventsResult.error) throw eventsResult.error;
    if (componentsResult.error) throw componentsResult.error;
    if (termsResult.error) throw termsResult.error;
    if (membershipsResult.error) throw membershipsResult.error;
    if (deliveriesResult.error) throw deliveriesResult.error;

    loaded.push({
      ownerId: account.owner_id,
      accountId: account.id,
      status: account.status,
      eventRows: eventsResult.data || [],
      componentRows: componentsResult.data || [],
      termsRows: termsResult.data || [],
      borrowers: (membershipsResult.data || []).map((membership) => ({
        borrowerId: membership.borrower_id,
        membershipStatus: membership.status,
        email: membership.private_financing_borrowers?.email ?? null,
        fullName: membership.private_financing_borrowers?.full_name ?? null,
      })),
      existingDeliveries: (deliveriesResult.data || []).map((delivery) => ({
        borrowerId: delivery.borrower_id,
        dueDate: delivery.due_date,
        reminderType: delivery.reminder_type,
        status: delivery.status,
      })),
      ownerDisplayName: "FORGE Private Financing",
    });
  }
  return loaded;
}

async function recordDeliveryOutcome(db, entry, outcome) {
  const { data: existing, error: lookupError } = await db
    .from("private_financing_payment_reminder_deliveries")
    .select("id, attempt_count")
    .eq("owner_id", entry.ownerId)
    .eq("account_id", entry.accountId)
    .eq("borrower_id", entry.borrowerId)
    .eq("due_date", entry.dueDate)
    .eq("reminder_type", entry.reminderType)
    .maybeSingle();
  if (lookupError) throw lookupError;

  const row = {
    owner_id: entry.ownerId,
    id: existing?.id || `pfrd_${entry.ownerId}_${entry.accountId}_${entry.borrowerId}_${entry.dueDate}_${entry.reminderType}`,
    account_id: entry.accountId,
    borrower_id: entry.borrowerId,
    due_date: entry.dueDate,
    reminder_type: entry.reminderType,
    status: outcome.status,
    provider_message_id: outcome.providerMessageId ?? null,
    failure_reason: outcome.failureReason ?? null,
    attempt_count: (existing?.attempt_count || 0) + 1,
    last_attempted_at: new Date().toISOString(),
  };
  const { error: upsertError } = await db.from("private_financing_payment_reminder_deliveries").upsert(row, {
    onConflict: "owner_id,account_id,borrower_id,due_date,reminder_type",
  });
  if (upsertError) throw upsertError;
}

// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET is set in
// the project env -- same pattern as the existing rental crons. This route is deliberately NOT yet
// registered in vercel.json (see the PR description) -- it exists and can be invoked manually
// (with the same secret) for verification, but does not run on a schedule until a separate,
// later authorization adds it there.
//
// ?dryRun=true calculates the full plan (including which emails WOULD be sent) without calling the
// email provider or writing any delivery row -- safe to run against production data for
// verification once the migration is applied.
export async function GET(request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`)
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";

  try {
    const db = createRentalWebhookClient();
    const asOfDate = todayISODate();
    const accounts = await loadAccountsForReminderRun(db);
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://marketplace409.vercel.app";
    const plan = planReminderRun({ asOfDate, accounts, siteUrl });

    let sent = 0;
    let failed = 0;
    let alreadySent = 0;
    let skipped = 0;
    let unavailable = 0;
    const unavailableAccounts = [];
    const wouldSend = plan.filter((entry) => entry.action === "send").length;

    if (!dryRun) {
      const emailProvider = createResendRentalEmailProvider();
      for (const entry of plan) {
        if (entry.action !== "send") continue;
        try {
          const result = await emailProvider.send({
            id: `private-financing-reminder-${entry.accountId}-${entry.borrowerId}-${entry.dueDate}-${entry.reminderType}`,
            senderName: "FORGE Private Financing",
            senderEmail: process.env.RENTAL_EMAIL_SENDER || "rentals@mail.409marketplace.online",
            recipient: entry.email,
            subject: entry.emailSubject,
            bodyText: entry.emailBody,
          });
          await recordDeliveryOutcome(db, entry, { status: "sent", providerMessageId: result.messageId });
          sent += 1;
        } catch (deliveryError) {
          console.error("Private financing payment-due reminder delivery failed", {
            accountId: entry.accountId,
            reminderType: entry.reminderType,
            code: deliveryError?.name || "unknown",
          });
          await recordDeliveryOutcome(db, entry, { status: "failed", failureReason: deliveryError?.message?.slice(0, 500) || "unknown" });
          failed += 1;
        }
      }
    }

    for (const entry of plan) {
      if (entry.action === "already_sent") alreadySent += 1;
      else if (entry.action === "skip") skipped += 1;
      else if (entry.action === "unavailable") {
        unavailable += 1;
        unavailableAccounts.push({ ownerId: entry.ownerId, accountId: entry.accountId, reason: entry.reason });
      }
    }
    if (unavailableAccounts.length > 0) {
      console.error("Private financing payment-due reminder: accounts needing review", {
        count: unavailableAccounts.length,
        accountIds: unavailableAccounts.map((entry) => entry.accountId),
      });
    }

    return NextResponse.json({
      success: true,
      dryRun,
      asOfDate,
      accountsEvaluated: accounts.length,
      sent,
      wouldSend,
      failed,
      alreadySent,
      skipped,
      unavailable,
    });
  } catch (error) {
    console.error("Private financing payment-due reminder cron error", error);
    return NextResponse.json({ error: "Unable to run payment-due reminders." }, { status: 500 });
  }
}
