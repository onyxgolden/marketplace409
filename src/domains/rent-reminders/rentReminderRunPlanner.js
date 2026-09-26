// Pure planner for automatic rent-due reminders.
//
// Input is one calendar date plus the unpaid rent charges in the reminder
// window, each carrying its lease tenants and prior delivery attempts:
//   charges: [{
//     ownerId, chargeId, leaseId, dueDate, amountCents, paidAmountCents, status,
//     tenants: [{ tenantId, email, fullName, tenantStatus }],
//     existingDeliveries: [{ tenantId, dueDate, reminderType, status, staleSending }],
//   }]
//
// The planner never touches the network. It emits one entry per tenant per
// logical delivery: { action: "send" | "already_sent" | "skip", ... }.
//
// Concurrency contract (enforced by the route, not here): the route claims the
// delivery row BEFORE calling the email provider, so overlapping cron runs
// produce at most one provider call per logical delivery.

import {
  REMINDER_TYPE,
  REMINDABLE_TENANT_STATUSES,
  computeReminderCandidate,
  evaluateChargeStillOwed,
  buildReminderEmail,
  buildPortalUrl,
} from "./rentDueReminders.js";

function normalizeEmail(value) {
  const email = (value || "").trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) ? email : "";
}

function emitTenantEntries({ results, charge, dueDate, reminderType, remainingCents, siteUrl, restrictToTenantIds, asOfDate }) {
  const tenants = (charge.tenants || []).filter((tenant) =>
    REMINDABLE_TENANT_STATUSES.includes(tenant.tenantStatus) &&
    (!restrictToTenantIds || restrictToTenantIds.has(tenant.tenantId)));
  if (tenants.length === 0) {
    if (!restrictToTenantIds) {
      results.push({ ownerId: charge.ownerId, chargeId: charge.chargeId, action: "skip", reason: "no_active_tenants" });
    }
    return;
  }
  const seenEmails = new Set();
  for (const tenant of tenants) {
    const base = {
      ownerId: charge.ownerId, chargeId: charge.chargeId, tenantId: tenant.tenantId,
      tenantName: tenant.fullName, dueDate, reminderType, remainingCents,
    };
    const email = normalizeEmail(tenant.email);
    if (!email) { results.push({ ...base, action: "skip", reason: "invalid_email" }); continue; }
    if (seenEmails.has(email)) { results.push({ ...base, email, action: "skip", reason: "duplicate_email_in_lease" }); continue; }
    seenEmails.add(email);
    const existing = (charge.existingDeliveries || []).find((delivery) =>
      delivery.tenantId === tenant.tenantId && delivery.dueDate === dueDate && delivery.reminderType === reminderType);
    if (existing?.status === "sent") { results.push({ ...base, email, action: "already_sent" }); continue; }
    if (existing?.status === "sending" && !existing.staleSending) {
      results.push({ ...base, email, action: "skip", reason: "delivery_in_progress" }); continue;
    }
    const rendered = buildReminderEmail({
      tenantName: tenant.fullName, tenantEmail: email, reminderType, dueDate,
      remainingCents, portalUrl: buildPortalUrl(siteUrl), asOfDate,
    });
    results.push({ ...base, email, action: "send", emailSubject: rendered.subject, emailBody: rendered.bodyText });
  }
}

export function planReminderRun({ asOfDate, charges, siteUrl }) {
  const results = [];
  for (const charge of charges || []) {
    const candidate = computeReminderCandidate({ charge, asOfDate });
    // The fresh grain must not be re-emitted as a retry: skip it below.
    const freshGrain = candidate.eligible ? `${candidate.dueDate}|${candidate.reminderType}` : null;
    if (candidate.eligible) {
      emitTenantEntries({
        results, charge, dueDate: candidate.dueDate, reminderType: candidate.reminderType,
        remainingCents: candidate.remainingCents, siteUrl, asOfDate,
      });
    } else {
      results.push({ ownerId: charge.ownerId, chargeId: charge.chargeId, action: "skip", reason: candidate.reason });
    }

    // Retry pass: failed deliveries, plus 'sending' rows abandoned by a crashed
    // invocation (marked staleSending by the caller), still inside their window.
    const retryGroups = new Map();
    for (const delivery of charge.existingDeliveries || []) {
      const retryable = delivery.status === "failed" || (delivery.status === "sending" && delivery.staleSending);
      if (!retryable) continue;
      const grain = `${delivery.dueDate}|${delivery.reminderType}`;
      if (grain === freshGrain) continue;
      if (!retryGroups.has(grain)) {
        retryGroups.set(grain, { dueDate: delivery.dueDate, reminderType: delivery.reminderType, tenantIds: new Set() });
      }
      retryGroups.get(grain).tenantIds.add(delivery.tenantId);
    }
    for (const group of retryGroups.values()) {
      const inWindow = group.reminderType === REMINDER_TYPE.DUE_DATE
        ? asOfDate === group.dueDate
        : asOfDate < group.dueDate;
      if (!inWindow) continue;
      // Live-state recheck: a payment landing between plan and retry suppresses.
      const owed = evaluateChargeStillOwed({ charge });
      if (!owed.owed) continue;
      emitTenantEntries({
        results, charge, dueDate: group.dueDate, reminderType: group.reminderType,
        remainingCents: owed.remainingCents, siteUrl, restrictToTenantIds: group.tenantIds, asOfDate,
      });
    }
  }
  return results;
}
