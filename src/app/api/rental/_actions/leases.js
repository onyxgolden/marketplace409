import { NextResponse } from "next/server";
import { createRentalLease } from "@/domains/rental-lease";
import { createRentSchedule, RENT_SCHEDULE_PAYMENT_FREQUENCIES } from "@/domains/rent-schedule";
import { badRequest, id, readOnlyWriteBlocked } from "./shared.js";

export async function saveLease({ authenticated, body, application, effectiveOwnerId, timestamp }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit leases." }, { status: 403 });
  const input = body.lease;
  if (!input || typeof input !== "object") return badRequest("lease is required.");
  const lease = createRentalLease({ ...input, id: id("rental_lease", input.id), status: input.status ?? "draft",
    endDate: input.endDate ?? null, beginChargesDate: input.beginChargesDate ?? null,
    documentEvidenceId: input.documentEvidenceId ?? null,
    activatedAt: input.activatedAt ?? null, endedAt: input.endedAt ?? null,
    createdAt: input.createdAt || timestamp, updatedAt: timestamp, notes: input.notes ?? null });
  // Primary-on-create: save_rental_lease inserts memberships with no role,
  // so every member lands as co_tenant (the column default) and the lease
  // has no primary — and add-co-tenant then 409s until someone detours to
  // another screen to set one. Read the pre-save memberships BEFORE the
  // save RPC wipes and reinserts them, then restore exactly one primary:
  // the pre-existing primary when it is still on the lease, otherwise the
  // first picked tenant. This never creates a second primary (the partial
  // unique index would refuse it) and never touches leases this save does
  // not write — existing primary-less leases stay as their owner left them
  // until the owner sets a primary via the existing make-primary action.
  const { data: priorMemberships, error: priorMembershipsError } = await authenticated.supabaseClient
    .from("rental_lease_tenants").select("tenant_id, occupancy_role")
    .eq("owner_id", effectiveOwnerId).eq("lease_id", lease.id);
  if (priorMembershipsError) throw priorMembershipsError;
  const saved = await application.saveLease(lease, effectiveOwnerId);
  const picked = lease.tenantIds || [];
  const priorPrimary = (priorMemberships || []).find((row) => row.occupancy_role === "primary")?.tenant_id;
  const target = (priorPrimary && picked.includes(priorPrimary)) ? priorPrimary : picked[0];
  if (target) {
    const { error: primaryError } = await authenticated.supabaseClient.rpc("set_rental_primary_tenant", {
      p_owner_id: effectiveOwnerId, p_lease_id: lease.id, p_tenant_id: target,
    });
    if (primaryError) throw primaryError;
  }
  return NextResponse.json({ success: true, lease: saved });
}

export async function saveSchedule({ authenticated, body, application, effectiveOwnerId, timestamp }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit rent schedules." }, { status: 403 });
  const input = body.schedule;
  if (!input || typeof input !== "object") return badRequest("schedule is required.");
  const schedule = createRentSchedule({ ...input, id: id("rent_schedule", input.id), status: input.status ?? "draft",
    effectiveEndDate: input.effectiveEndDate ?? null, createdAt: input.createdAt || timestamp, updatedAt: timestamp });
  // Controls-sweep G1: a schedule on a cancelled lease must not change —
  // this is the early-pay window guard (L-09), which previously accepted.
  if (schedule.leaseId) {
    const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
      .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", schedule.leaseId).maybeSingle();
    if (leaseError) throw leaseError;
    if (lease?.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be changed." }, { status: 409 });
  }
  return NextResponse.json({ success: true, schedule: await application.saveSchedule(schedule, effectiveOwnerId) });
}

export async function cancelLease({ authenticated, body, effectiveOwnerId, timestamp }) {
  if (typeof body.leaseId !== "string" || body.leaseId.trim() === "") return badRequest("leaseId is required.");
  const { data, error } = await authenticated.supabaseClient.from("rental_leases")
    .update({ status: "cancelled", updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("id", body.leaseId.trim()).eq("status", "draft")
    .select("id, status").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Only a draft lease can be cancelled." }, { status: 409 });
  return NextResponse.json({ success: true, lease: data });
}

export async function restoreLease({ authenticated, body, effectiveOwnerId, timestamp }) {
  // Controls-sweep G3: restore a cancelled lease to draft (L-03). Cancel only
  // ever applies to draft leases, so a cancelled lease never had charges
  // generated — restoring returns it to exactly the state it was in before
  // cancel, with its draft schedule intact. No financial side effects to
  // unwind, and no new lease id: memberships and history keep continuity.
  if (typeof body.leaseId !== "string" || body.leaseId.trim() === "") return badRequest("leaseId is required.");
  const { data, error } = await authenticated.supabaseClient.from("rental_leases")
    .update({ status: "draft", updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("id", body.leaseId.trim()).eq("status", "cancelled")
    .select("id, status").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Only a cancelled lease can be restored." }, { status: 409 });
  return NextResponse.json({ success: true, lease: data });
}

export async function endLease({ authenticated, body, effectiveOwnerId, timestamp }) {
  // End an ACTIVE lease (B1). Ending stops future charge generation and
  // unblocks archiving the unit (archiveUnit only refuses ACTIVE leases).
  // Deliberate semantics, documented here so review can hold them:
  // - The lease row moves to status "ended" with end_date + ended_at set.
  // - Active rent schedules for the lease move to "ended" too, so the
  //   charge generator (which requires an active schedule) never creates
  //   another charge for the ended term.
  // - Open charges are left exactly as they are: history is preserved and
  //   any remaining balance stays collectible (void/refund are separate
  //   actions). Nothing is deleted.
  if (typeof body.leaseId !== "string" || body.leaseId.trim() === "") return badRequest("leaseId is required.");
  const leaseId = body.leaseId.trim();
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const endDate = body.endDate === null || body.endDate === undefined || body.endDate === ""
    ? new Date().toISOString().slice(0, 10) : String(body.endDate).trim();
  if (!datePattern.test(endDate)) return badRequest("A valid end date (YYYY-MM-DD) is required.");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", leaseId).maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) return NextResponse.json({ error: "Lease was not found." }, { status: 404 });
  if (lease.status !== "active") return NextResponse.json({ error: "Only an active lease can be ended." }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("rental_leases")
    .update({ status: "ended", end_date: endDate, ended_at: timestamp, updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("id", leaseId).eq("status", "active")
    .select("id, status, end_date").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Only an active lease can be ended." }, { status: 409 });
  const { data: endedSchedules, error: scheduleError } = await authenticated.supabaseClient.from("rent_schedules")
    .update({ status: "ended", updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("lease_id", leaseId).eq("status", "active")
    .select("id");
  if (scheduleError) throw scheduleError;
  return NextResponse.json({ success: true, lease: data, schedulesEnded: (endedSchedules || []).length, reason: reason || null });
}

export async function updateLeaseTerms({ authenticated, body, effectiveOwnerId, timestamp }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit leases." }, { status: 403 });
  const input = body.terms;
  if (!input || typeof input !== "object") return badRequest("terms is required.");
  if (typeof input.leaseId !== "string" || input.leaseId.trim() === "") return badRequest("leaseId is required.");
  const leaseId = input.leaseId.trim();
  const monthlyRentCents = Number(input.monthlyRentCents);
  if (!Number.isSafeInteger(monthlyRentCents) || monthlyRentCents <= 0) return badRequest("Monthly rent must be a positive whole-cent amount.");
  const rentDueDay = Number(input.rentDueDay);
  if (!Number.isInteger(rentDueDay) || rentDueDay < 1 || rentDueDay > 28) return badRequest("Due day must be between 1 and 28.");
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof input.startDate !== "string" || !datePattern.test(input.startDate)) return badRequest("A valid start date (YYYY-MM-DD) is required.");
  const endDate = input.endDate === null || input.endDate === undefined || input.endDate === "" ? null : input.endDate;
  if (endDate !== null && (typeof endDate !== "string" || !datePattern.test(endDate))) return badRequest("A valid end date (YYYY-MM-DD) is required.");
  if (endDate !== null && endDate < input.startDate) return badRequest("The end date cannot be before the start date.");
  const earlyPayDays = Number(input.earlyPayDays);
  if (!Number.isInteger(earlyPayDays) || earlyPayDays < 0 || earlyPayDays > 31) return badRequest("Early pay window must be between 0 and 31 days.");
  // R10: begin-charges date is optional — omitted/blank keeps the lease's
  // current value (never clobbers), a provided value must be a valid date.
  const rawBeginCharges = input.beginChargesDate === null || input.beginChargesDate === undefined
    ? "" : String(input.beginChargesDate).trim();
  if (rawBeginCharges !== "" && !datePattern.test(rawBeginCharges)) return badRequest("A valid begin-charges date (YYYY-MM-DD) is required.");
  const beginChargesDate = rawBeginCharges === "" ? null : rawBeginCharges;
  // R13: payment frequency is optional on edit-terms. It lives only on the
  // rent_schedules row (the charge cron's single read source), so it is
  // written by a second, owner-scoped update right after the atomic
  // terms RPC -- there is no lease-row counterpart to drift against.
  // Changing the frequency resets the cadence anchor to today unless the
  // caller passes an explicit anchor, so a mid-lease switch never
  // backfills weeks of "missed" charges under the old cadence. Charges
  // already generated keep their original terms and are never rewritten.
  const paymentFrequency = input.paymentFrequency ?? null;
  if (paymentFrequency !== null && !RENT_SCHEDULE_PAYMENT_FREQUENCIES.includes(paymentFrequency))
    return badRequest("Payment frequency must be weekly, biweekly, or monthly.");
  const paymentAnchorDate = input.paymentAnchorDate ?? null;
  if (paymentAnchorDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paymentAnchorDate))
    return badRequest("Payment anchor date must use YYYY-MM-DD format.");
  const todayStr = new Date().toISOString().slice(0, 10);
  // Owner-scoped lookup: a lease from another workspace resolves to 404, never a 403
  // that would leak its existence.
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", leaseId).maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) return NextResponse.json({ error: "Lease was not found." }, { status: 404 });
  if (lease.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be edited." }, { status: 409 });
  // Atomic write: update_lease_terms updates the rent_schedules row and the
  // rental_leases row inside a single database transaction, so the two can
  // never drift apart. Reports read lease.monthly_rent_cents while the
  // charge cron (generate_monthly_rent_charge) reads the schedule row when
  // each charge is generated — so the new terms apply to future charges
  // only. Already-generated charges keep their original terms and are never
  // rewritten by this operation.
  //
  // All auth decisions stay here in the route (owner-scoped lease lookup
  // above, read-only gate, cancelled rejection); the function only does the
  // atomic write. The schedule-existence check lives inside the function's
  // transaction (locked SELECT) — there is no separate pre-check here, so
  // no race can slip between the check and the write.
  const { data: termsResult, error: termsError } = await authenticated.supabaseClient.rpc("update_lease_terms", {
    p_owner_id: effectiveOwnerId,
    p_lease_id: leaseId,
    p_monthly_rent_cents: monthlyRentCents,
    p_due_day: rentDueDay,
    p_start_date: input.startDate,
    p_end_date: endDate,
    p_early_pay_days: earlyPayDays,
    p_begin_charges_date: beginChargesDate,
  });
  if (termsError) {
    const message = String(termsError.message || "");
    if (message.includes("rent schedule not found for lease"))
      return NextResponse.json({ error: "No rent schedule found for this lease — save one before editing terms." }, { status: 409 });
    if (message.includes("lease not found"))
      return NextResponse.json({ error: "Lease was not found." }, { status: 404 });
    throw termsError;
  }
  let schedule = termsResult?.schedule ?? null;
  if (paymentFrequency !== null) {
    const { data: currentSchedule, error: currentScheduleError } = await authenticated.supabaseClient
      .from("rent_schedules").select("id, payment_frequency").eq("owner_id", effectiveOwnerId)
      .eq("lease_id", leaseId).maybeSingle();
    if (currentScheduleError) throw currentScheduleError;
    // Anchor reset on frequency change only; an explicit anchor always wins.
    const anchorDate = paymentAnchorDate ?? (currentSchedule?.payment_frequency !== paymentFrequency ? todayStr : null);
    const frequencyUpdate = { payment_frequency: paymentFrequency, updated_at: timestamp };
    if (anchorDate !== null) frequencyUpdate.payment_anchor_date = anchorDate;
    const { data: updatedSchedule, error: frequencyError } = await authenticated.supabaseClient
      .from("rent_schedules").update(frequencyUpdate).eq("owner_id", effectiveOwnerId)
      .eq("lease_id", leaseId).select("*").maybeSingle();
    if (frequencyError) throw frequencyError;
    schedule = updatedSchedule ?? schedule;
  }
  return NextResponse.json({ success: true, lease: termsResult?.lease, schedule });
}

export async function generateCharge({ body, application, effectiveOwnerId }) {
  if (!body.scheduleId || !body.period) return badRequest("scheduleId and period are required.");
  const charge = await application.generateMonthlyCharge(body.scheduleId, body.period, effectiveOwnerId);
  if (!charge) return NextResponse.json({ error: "The schedule must be active and effective for the selected month." }, { status: 409 });
  return NextResponse.json({ success: true, charge });
}

export async function voidCharge({ authenticated, body, effectiveOwnerId }) {
  if (typeof body.chargeId !== "string" || body.chargeId.trim() === "") return badRequest("chargeId is required.");
  if (typeof body.reason !== "string" || body.reason.trim() === "") return badRequest("A reason is required to void a charge.");
  const { data, error } = await authenticated.supabaseClient.rpc("void_rental_rent_charge",
    { p_owner_id: effectiveOwnerId, p_charge_id: body.chargeId.trim(), p_reason: body.reason.trim() });
  if (error) throw error;
  if (!data || !data.id) return NextResponse.json({ error: "Only a charge with no paid balance, not already voided, and no pending or unreversed payment can be voided." }, { status: 409 });
  return NextResponse.json({ success: true, charge: data });
}

export async function activateForgeBilling({ authenticated, body, effectiveOwnerId }) {
  if (typeof body.scheduleId !== "string" || body.scheduleId.trim() === "") return badRequest("scheduleId is required.");
  if (typeof body.cutoverDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.cutoverDate)) return badRequest("A valid cutoverDate (YYYY-MM-DD) is required.");
  const { data, error } = await authenticated.supabaseClient.rpc("activate_forge_billing_collection", {
    p_owner_id: effectiveOwnerId, p_schedule_id: body.scheduleId.trim(), p_cutover_date: body.cutoverDate,
    p_reconciliation_summary: body.reconciliationSummary && typeof body.reconciliationSummary === "object" ? body.reconciliationSummary : {},
  });
  if (error) throw error;
  return NextResponse.json({ success: true, schedule: data });
}

export async function setBillingEnabled({ authenticated, body, effectiveOwnerId }) {
  if (typeof body.enabled !== "boolean") return badRequest("enabled must be boolean.");
  const { data, error } = await authenticated.supabaseClient.rpc("set_rental_billing_enabled", {
    p_owner_id: effectiveOwnerId, p_enabled: body.enabled,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, settings: data });
}

export async function activateLeaseSchedule({ authenticated, body, effectiveOwnerId }) {
  if (!body.scheduleId) return badRequest("scheduleId is required.");
  const { data, error } = await authenticated.supabaseClient.rpc("activate_rental_lease_schedule", {
    p_owner_id: effectiveOwnerId, p_schedule_id: body.scheduleId,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, activation: data });
}

export async function saveLeaseChange({ authenticated, body, effectiveOwnerId }) {
  const input = body.change;
  if (!input?.leaseId || !["renewal", "amendment", "proration"].includes(input.changeType) || !input.effectiveDate || !input.reason?.trim())
    return badRequest("Lease, supported change type, effective date, and reason are required.");
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases").select("*").eq("owner_id", effectiveOwnerId).eq("id", input.leaseId).maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) return NextResponse.json({ error: "Lease was not found." }, { status: 404 });
  // Controls-sweep G1: a renewal/amendment on a cancelled lease must not
  // create a new active schedule while the lease stays cancelled (L-10).
  if (lease.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be changed." }, { status: 409 });
  const newTerms = input.changeType === "proration"
    ? { amountCents: Number(input.amountCents) }
    : { monthlyRentCents: Number(input.monthlyRentCents) || lease.monthly_rent_cents, rentDueDay: Number(input.rentDueDay) || lease.rent_due_day, endDate: input.endDate || lease.end_date };
  if (input.changeType === "proration" && (!Number.isSafeInteger(newTerms.amountCents) || newTerms.amountCents <= 0))
    return badRequest("Proration requires a positive amount.");
  const { data, error } = await authenticated.supabaseClient.from("rental_lease_changes").insert({
    owner_id: effectiveOwnerId, id: id("rental_lease_change", input.id), lease_id: lease.id, change_type: input.changeType,
    status: "draft", effective_date: input.effectiveDate,
    previous_terms: { monthlyRentCents: Number(lease.monthly_rent_cents), rentDueDay: lease.rent_due_day, endDate: lease.end_date },
    new_terms: newTerms, reason: input.reason.trim(), document_evidence_id: input.documentEvidenceId || null,
  }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, change: data });
}

export async function approveLeaseChange({ authenticated, body, effectiveOwnerId, timestamp }) {
  if (!body.changeId) return badRequest("changeId is required.");
  // Controls-sweep G1: approving a draft change on a lease that was cancelled
  // after the draft was saved must not create an active schedule on it.
  const { data: change, error: changeError } = await authenticated.supabaseClient.from("rental_lease_changes")
    .select("id, lease_id").eq("owner_id", effectiveOwnerId).eq("id", body.changeId).maybeSingle();
  if (changeError) throw changeError;
  if (change?.lease_id) {
    const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
      .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", change.lease_id).maybeSingle();
    if (leaseError) throw leaseError;
    if (lease?.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be changed." }, { status: 409 });
  }
  const { data: approved, error: approvalError } = await authenticated.supabaseClient.from("rental_lease_changes")
    .update({ status: "approved", approved_at: timestamp }).eq("owner_id", effectiveOwnerId).eq("id", body.changeId).eq("status", "draft")
    .select("id").maybeSingle();
  if (approvalError) throw approvalError;
  if (!approved) return NextResponse.json({ error: "Draft lease change was not found." }, { status: 404 });
  const { data, error } = await authenticated.supabaseClient.rpc("apply_rental_lease_change", { p_owner_id: effectiveOwnerId, p_change_id: body.changeId });
  if (error) throw error;
  return NextResponse.json({ success: true, application: data });
}

export async function saveLeasePreparationVersion({ authenticated, body, effectiveOwnerId }) {
  const input = body.preparation;
  if (!input?.leaseId || !input?.title?.trim() || !input?.changeSummary?.trim() || !input.terms || typeof input.terms !== "object" || Array.isArray(input.terms))
    return badRequest("Lease, title, change summary, and structured terms are required.");
  const { data, error } = await authenticated.supabaseClient.rpc("save_rental_lease_preparation_version", {
    p_owner_id: effectiveOwnerId, p_lease_id: input.leaseId, p_title: input.title.trim(),
    p_terms: input.terms, p_change_summary: input.changeSummary.trim(),
  });
  if (error) throw error;
  return NextResponse.json({ success: true, preparation: data });
}

export async function approveLeasePreparationVersion({ authenticated, body, effectiveOwnerId }) {
  const version = Number(body.versionNumber);
  if (!body.preparationId || !Number.isInteger(version) || version < 1 || body.ownerApprovalConfirmed !== true)
    return badRequest("Preparation, version, and explicit owner approval are required.");
  // Controls-sweep G1 (Q-11): a preparation approval on a cancelled lease
  // must not publish terms for a dead lease.
  const { data: preparation, error: preparationError } = await authenticated.supabaseClient.from("rental_lease_preparations")
    .select("id, lease_id").eq("owner_id", effectiveOwnerId).eq("id", body.preparationId).maybeSingle();
  if (preparationError) throw preparationError;
  if (preparation?.lease_id) {
    const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
      .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", preparation.lease_id).maybeSingle();
    if (leaseError) throw leaseError;
    if (lease?.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be changed." }, { status: 409 });
  }
  const { data, error } = await authenticated.supabaseClient.rpc("approve_rental_lease_preparation_version", {
    p_owner_id: effectiveOwnerId, p_preparation_id: body.preparationId, p_version_number: version,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, preparation: data });
}
