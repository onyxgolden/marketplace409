import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { badRequest, now } from "./_actions/shared.js";
import { saveUnit, setUnitStatus, restoreUnit, archiveUnit, deleteArchivedUnit } from "./_actions/units.js";
import {
  saveTenant, deleteUnusedTenant, updateTenantEmail, sendTenantInvite,
  updateTenantProfile, setPrimaryTenant, addCoTenant, removeCoTenant, reviewAnimal,
} from "./_actions/tenants.js";
import {
  saveLease, saveSchedule, cancelLease, restoreLease, endLease, updateLeaseTerms, generateCharge, voidCharge,
  activateForgeBilling, setBillingEnabled, activateLeaseSchedule, setScheduleStatus, setPaymentFrequency, saveLeaseChange,
  approveLeaseChange, saveLeasePreparationVersion, approveLeasePreparationVersion,
} from "./_actions/leases.js";
import {
  recordOfflinePayment, setPaymentDepositState, applyTenantCredit, voidTenantCredit,
  voidPayment, refundPayment, createTenantCredit,
  saveConvenienceFee, savePaymentPolicy, savePaymentPolicyTenantOverride,
} from "./_actions/payments.js";
import { queueRentReminder, cancelRentNotification, queueInsuranceRenewals } from "./_actions/notifications.js";
import { pauseAutopay, resumeAutopay, cancelAutopay, updateAutopay } from "./_actions/autopay.js";
import {
  updateMaintenanceRequest, createMaintenanceRequest, saveContractor, updateContractor,
  deactivateContractor, reactivateContractor, recordContractorPayment, updateSupportCase,
  createMaintenanceWorkOrder, updateMaintenanceWorkOrder,
} from "./_actions/maintenance.js";
import { saveSecurityDeposit, updateSecurityDeposit, voidSecurityDeposit, recordSecurityDepositTransaction, voidSecurityDepositTransaction } from "./_actions/deposits.js";
import { saveInspection, finalizeInspection } from "./_actions/inspections.js";
import {
  saveLateFeeRule, assessLateFee, saveLateFeeAutoSettings, saveLateFeeTenantOverride,
} from "./_actions/lateFees.js";

// Operation dispatch table: each action module owns its logic; this route only
// authenticates, parses the body, and dispatches. Behavior is identical to the
// pre-split switch — same operation names, same handlers, same error mapping.
// Null-prototype on purpose: inherited Object.prototype keys ("constructor",
// "toString", "__proto__", "hasOwnProperty") must never dispatch to a handler.
const OPERATION_HANDLERS = Object.assign(Object.create(null), {
  "save-unit": saveUnit,
  "set-unit-status": setUnitStatus,
  "restore-unit": restoreUnit,
  "archive-unit": archiveUnit,
  "delete-archived-unit": deleteArchivedUnit,
  "review-animal": reviewAnimal,
  "save-tenant": saveTenant,
  "delete-unused-tenant": deleteUnusedTenant,
  "update-tenant-email": updateTenantEmail,
  "send-tenant-invite": sendTenantInvite,
  "update-tenant-profile": updateTenantProfile,
  "set-primary-tenant": setPrimaryTenant,
  "add-co-tenant": addCoTenant,
  "remove-co-tenant": removeCoTenant,
  "save-lease": saveLease,
  "save-schedule": saveSchedule,
  "cancel-lease": cancelLease,
  "restore-lease": restoreLease,
  "end-lease": endLease,
  "update-lease-terms": updateLeaseTerms,
  "generate-charge": generateCharge,
  "void-charge": voidCharge,
  "activate-forge-billing": activateForgeBilling,
  "set-billing-enabled": setBillingEnabled,
  "save-convenience-fee": saveConvenienceFee,
  "activate-lease-schedule": activateLeaseSchedule,
  "set-schedule-status": setScheduleStatus,
  "set-payment-frequency": setPaymentFrequency,
  "record-offline-payment": recordOfflinePayment,
  "set-payment-deposit-state": setPaymentDepositState,
  "apply-tenant-credit": applyTenantCredit,
  "void-tenant-credit": voidTenantCredit,
  "void-payment": voidPayment,
  "refund-payment": refundPayment,
  "create-tenant-credit": createTenantCredit,
  "pause-autopay": pauseAutopay,
  "resume-autopay": resumeAutopay,
  "cancel-autopay": cancelAutopay,
  "update-autopay": updateAutopay,
  "queue-rent-reminder": queueRentReminder,
  "cancel-rent-notification": cancelRentNotification,
  "queue-insurance-renewals": queueInsuranceRenewals,
  "update-maintenance-request": updateMaintenanceRequest,
  "create-maintenance-request": createMaintenanceRequest,
  "save-security-deposit": saveSecurityDeposit,
  "update-security-deposit": updateSecurityDeposit,
  "void-security-deposit": voidSecurityDeposit,
  "record-security-deposit-transaction": recordSecurityDepositTransaction,
  "void-security-deposit-transaction": voidSecurityDepositTransaction,
  "save-inspection": saveInspection,
  "finalize-inspection": finalizeInspection,
  "save-lease-change": saveLeaseChange,
  "approve-lease-change": approveLeaseChange,
  "save-late-fee-rule": saveLateFeeRule,
  "assess-late-fee": assessLateFee,
  "save-late-fee-auto-settings": saveLateFeeAutoSettings,
  "save-late-fee-tenant-override": saveLateFeeTenantOverride,
  "save-payment-policy": savePaymentPolicy,
  "save-payment-policy-tenant-override": savePaymentPolicyTenantOverride,
  "save-contractor": saveContractor,
  "update-contractor": updateContractor,
  "deactivate-contractor": deactivateContractor,
  "reactivate-contractor": reactivateContractor,
  "record-contractor-payment": recordContractorPayment,
  "update-support-case": updateSupportCase,
  "create-maintenance-work-order": createMaintenanceWorkOrder,
  "update-maintenance-work-order": updateMaintenanceWorkOrder,
  "save-lease-preparation-version": saveLeasePreparationVersion,
  "approve-lease-preparation-version": approveLeasePreparationVersion,
});

async function withPhotoUrls(supabaseClient, records) {
  return Promise.all(records.map(async (record) => {
    if (!record.photo_bucket || !record.photo_object_path) return { ...record, photo_url: null };
    const { data, error } = await supabaseClient.storage.from(record.photo_bucket).createSignedUrl(record.photo_object_path, 3600);
    return { ...record, photo_url: error ? null : data.signedUrl };
  }));
}

export async function GET() {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const [chargesResult, unitsResult, tenantsResult, schedulesResult, maintenanceResult, notificationResult, paymentResult, settlementResult, depositResult, depositTransactionResult, inspectionResult, inspectionItemResult, inspectionAckResult, leaseResult, membershipResult, leaseChangeResult, lateRuleResult, lateAssessmentResult, lateAutoSettingsResult, lateTenantOverrideResult, contractorResult, workOrderResult, workEventResult, leasePreparationResult, leasePreparationVersionResult, leaseSignatureResult, autopayResult, insurancePolicyResult, insuranceRequirementResult, animalResult, supportResult, financialEventResult, conversationResult, creditsResult] = await Promise.all([
      authenticated.supabaseClient.from("rent_charges")
        .select("id, lease_id, schedule_id, period, due_date, amount_cents, paid_amount_cents, currency_code, status, charge_type, related_charge_id")
        .in("status", ["scheduled", "due", "partially_paid", "overdue"]).order("due_date", { ascending: true }),
      authenticated.supabaseClient.from("rental_units")
        .select("id, property_id, label, status, photo_bucket, photo_object_path").order("label", { ascending: true }),
      authenticated.supabaseClient.from("rental_tenants")
        .select("id, display_name, email, phone, work_phone, employer_name, employer_phone, monthly_income_cents, emergency_contact_name, emergency_contact_phone, application_status, application_submitted_at, screening_provider, screening_reference, screening_status, screening_completed_at, ssn_last_four, landlord_notes, status, invited_at, auth_user_id, payment_policy, photo_bucket, photo_object_path").order("display_name", { ascending: true }),
      authenticated.supabaseClient.from("rent_schedules")
        .select("id, lease_id, status, amount_cents, currency_code, due_day, effective_start_date, effective_end_date, collection_mode, collection_provider, forge_cutover_date, payment_frequency, payment_anchor_date")
        .order("effective_start_date", { ascending: false }),
      authenticated.supabaseClient.from("rental_maintenance_requests")
        .select("id, lease_id, unit_id, tenant_id, title, description, priority, status, permission_to_enter, contact_phone, owner_notes, submitted_at, updated_at, completed_at")
        .order("submitted_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_notification_outbox")
        .select("id, tenant_id, lease_id, notification_type, channel, recipient, subject, body_text, status, failure_message, scheduled_for, attempt_count, max_attempts, next_attempt_at, created_at, sent_at")
        .order("created_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_payments")
        .select("id, charge_id, lease_id, tenant_id, provider, provider_payment_id, amount_cents, refunded_amount_cents, currency_code, status, payment_method, received_at, succeeded_at, created_at, deposit_state, deposited_at")
        .order("created_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_settlements")
        .select("id, payment_id, provider, provider_balance_transaction_id, provider_payout_id, gross_amount_cents, fee_amount_cents, net_amount_cents, currency_code, status, available_at, paid_out_at, created_at")
        .order("created_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_security_deposits").select("*").order("created_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_security_deposit_transactions").select("*").order("occurred_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_inspections").select("*").order("inspection_date", { ascending: false }),
      authenticated.supabaseClient.from("rental_inspection_items").select("*").order("created_at", { ascending: true }),
      authenticated.supabaseClient.from("rental_inspection_acknowledgements").select("*").order("acknowledged_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_leases").select("*").order("start_date",{ascending:false}),
      authenticated.supabaseClient.from("rental_lease_tenants").select("lease_id, tenant_id, occupancy_role").order("lease_id",{ascending:true}),
      authenticated.supabaseClient.from("rental_lease_changes").select("*").order("created_at",{ascending:false}),
      authenticated.supabaseClient.from("rental_late_fee_rules").select("*").order("created_at",{ascending:false}),
      authenticated.supabaseClient.from("rental_late_fee_assessments").select("*").order("approved_at",{ascending:false}),
      authenticated.supabaseClient.from("rental_billing_settings")
        .select("owner_id, late_fee_auto_post, late_fee_grace_days, late_fee_calculation_type, late_fee_fixed_amount_cents, late_fee_percentage_basis_points, late_fee_maximum_amount_cents, payment_policy, card_convenience_fee_bps")
        .eq("owner_id", authenticated.effectiveOwnerId).maybeSingle(),
      authenticated.supabaseClient.from("rental_late_fee_tenant_overrides").select("*").order("tenant_id",{ascending:true}),
      authenticated.supabaseClient.from("rental_contractors").select("*").order("business_name",{ascending:true}),
      authenticated.supabaseClient.from("rental_maintenance_work_orders").select("*").order("created_at",{ascending:false}),
      authenticated.supabaseClient.from("rental_maintenance_work_events").select("*").order("occurred_at",{ascending:false}),
      authenticated.supabaseClient.from("rental_lease_preparations").select("*").order("updated_at",{ascending:false}),
      authenticated.supabaseClient.from("rental_lease_preparation_versions").select("*").order("version_number",{ascending:false}),
      authenticated.supabaseClient.from("rental_lease_signatures").select("id, lease_id, preparation_id, version_number, tenant_id, signer_name, signed_at").order("signed_at",{ascending:false}),
      authenticated.supabaseClient.from("rental_autopay_enrollments").select("*").order("created_at",{ascending:false}),
      authenticated.supabaseClient.from("renters_insurance_policies").select("*").order("expiration_date",{ascending:true}),
      // Whether renter's insurance is even required for a given lease -- distinct from the policies
      // above (proof it was obtained). Without this, a lease that has deliberately opted out of an
      // insurance requirement would otherwise be misread as "missing" insurance.
      authenticated.supabaseClient.from("renters_insurance_requirements").select("lease_id, required, minimum_liability_cents").order("lease_id",{ascending:true}),
      authenticated.supabaseClient.from("rental_animals").select("*").order("created_at",{ascending:false}),
      authenticated.supabaseClient.from("rental_support_cases").select("*").order("opened_at",{ascending:false}),
      // Read-only, owner-scoped explicitly (not just via RLS) like every table above. Used only to
      // build the Rental Summary's Portfolio performance chart (collected vs. rental operating
      // expenses) — never written to from this route, and never used to alter billing, collection
      // authority, or any charge/payment/reconciliation behavior. See
      // buildRentalFinancialPerformance.js for the source_system scoping this powers. Paginated via
      // fetchAllOwnerFinancialEvents — a plain unbounded .select() is silently capped by
      // PostgREST's default page size (1000 rows), which for an owner with more financial_events
      // history than that (this owner has 5,600+) would truncate to only the oldest rows when
      // ordered by event_date ascending, making recent years vanish from the chart entirely.
      // Read model: a co-owner reads the canonical owner's rows, never their own fallback
      // workspace. financial_events is explicitly owner-scoped here (not just via RLS) for the
      // Portfolio performance chart.
      fetchAllOwnerFinancialEvents(authenticated.supabaseClient, authenticated.effectiveOwnerId, {
        columns: "event_date, amount, transaction_kind, source_system, status, is_deleted, business_scope",
      }).then((data) => ({ data, error: null })).catch((caught) => ({ data: null, error: caught })),
      authenticated.supabaseClient.from("rental_conversations").select("id, tenant_id, work_order_id, last_message_at, last_message_body, last_message_sender_type, owner_last_read_at, tenant_last_read_at").order("last_message_at",{ascending:false}),
      // Unapplied overpayment credits, for per-lease balance display only: the
      // lease view's balance is open-charge remaining minus unapplied credit
      // remainder. Credit applications are memo-only (remaining_cents already
      // nets them) and are not fetched.
      authenticated.supabaseClient.from("rental_tenant_credits").select("id, lease_id, tenant_id, remaining_cents, status").order("created_at", { ascending: true }),
    ]);
    const error = chargesResult.error || unitsResult.error || tenantsResult.error || schedulesResult.error || maintenanceResult.error || notificationResult.error || paymentResult.error || settlementResult.error || depositResult.error || depositTransactionResult.error || inspectionResult.error || inspectionItemResult.error || inspectionAckResult.error || leaseResult.error || membershipResult.error || leaseChangeResult.error || lateRuleResult.error || lateAssessmentResult.error || lateAutoSettingsResult.error || lateTenantOverrideResult.error || contractorResult.error || workOrderResult.error || workEventResult.error || leasePreparationResult.error || leasePreparationVersionResult.error || leaseSignatureResult.error || autopayResult.error || insurancePolicyResult.error || insuranceRequirementResult.error || animalResult.error || supportResult.error || financialEventResult.error || conversationResult.error || creditsResult.error;
    if (error) throw error;
    const [unitsWithPhotos, tenantsWithPhotos] = await Promise.all([
      withPhotoUrls(authenticated.supabaseClient, unitsResult.data || []),
      withPhotoUrls(authenticated.supabaseClient, tenantsResult.data || []),
    ]);
    // Dashboard balances must distinguish FORGE-collectible from externally-managed charges — a
    // charge on an 'external'/'paused' (or not-yet-cut-over) schedule must never read as a FORGE
    // overdue balance just because it exists and is unpaid. This only classifies what's
    // determinable from FORGE's own data; genuine reconciliation-difference detection (comparing
    // against actual Rentec evidence) lives in /api/rental/reconciliation-preview, not here.
    const today = new Date().toISOString().slice(0, 10);
    const scheduleById = new Map((schedulesResult.data || []).map((s) => [s.id, s]));
    const collectionSummary = (chargesResult.data || []).reduce((summary, charge) => {
      const schedule = scheduleById.get(charge.schedule_id);
      const isForgeCollectible = schedule?.collection_mode === "forge"
        && schedule.forge_cutover_date !== null && schedule.forge_cutover_date <= today;
      const remainingCents = Number(charge.amount_cents) - Number(charge.paid_amount_cents);
      if (isForgeCollectible) { summary.forgeCollectibleCents += remainingCents; summary.forgeCollectibleCount += 1; }
      else { summary.externallyManagedCents += remainingCents; summary.externallyManagedCount += 1; }
      return summary;
    }, { forgeCollectibleCents: 0, forgeCollectibleCount: 0, externallyManagedCents: 0, externallyManagedCount: 0 });

    // Owner-level master pause: FORGE may collect only when this is enabled AND the individual
    // schedule is cut over — this flag alone never activates a single lease. Production defaults
    // every owner to absent (paused), so the row may not exist yet.
    // Owner-level master pause: a co-owner reads the canonical owner's setting, not their own row.
    const { data: billingSettingsRow, error: billingSettingsError } = await authenticated.supabaseClient
      .from("rental_billing_settings").select("billing_enabled").eq("owner_id", authenticated.effectiveOwnerId).maybeSingle();
    if (billingSettingsError) throw billingSettingsError;
    const billingEnabled = billingSettingsRow?.billing_enabled === true;

    return NextResponse.json({ success: true, actingUserId: authenticated.user.id, canonicalOwnerId: authenticated.effectiveOwnerId,
      openCharges: chargesResult.data || [], collectionSummary, billingEnabled, credits: creditsResult.data || [],
      units: unitsWithPhotos, tenants: tenantsWithPhotos, schedules: schedulesResult.data || [],
      maintenanceRequests: maintenanceResult.data || [], notifications: notificationResult.data || [],
      payments: paymentResult.data || [], settlements: settlementResult.data || [], deposits: depositResult.data || [],
      depositTransactions: depositTransactionResult.data || [], inspections: inspectionResult.data || [],
      inspectionItems: inspectionItemResult.data || [], inspectionAcknowledgements: inspectionAckResult.data || [],
      leases:leaseResult.data||[],leaseMemberships:membershipResult.data||[],leaseChanges:leaseChangeResult.data||[],lateFeeRules:lateRuleResult.data||[],lateFeeAssessments:lateAssessmentResult.data||[],lateFeeAutoSettings:lateAutoSettingsResult.data||null,convenienceFeeBps:lateAutoSettingsResult.data?.card_convenience_fee_bps??0,lateFeeTenantOverrides:lateTenantOverrideResult.data||[],paymentPolicy:lateAutoSettingsResult.data?.payment_policy||"allow_any_amount",contractors:contractorResult.data||[],workOrders:workOrderResult.data||[],workEvents:workEventResult.data||[],leasePreparations:leasePreparationResult.data||[],leasePreparationVersions:leasePreparationVersionResult.data||[],leaseSignatures:leaseSignatureResult.data||[],autopayEnrollments:autopayResult.data||[],insurancePolicies:insurancePolicyResult.data||[],insuranceRequirements:insuranceRequirementResult.data||[],animals:animalResult.data||[],supportCases:supportResult.data||[],financialEvents:financialEventResult.data||[],
      // unread: the tenant sent the most recent message and the owner hasn't read past it yet --
      // never derived from tenant_last_read_at, which says nothing about what the OWNER has seen.
      // Work-order threads are conversation rows with work_order_id set; their unread flag is
      // attached to the work order so the maintenance panel can badge it.
      conversations:(conversationResult.data||[]).map(row=>({id:row.id,tenantId:row.tenant_id,lastMessageAt:row.last_message_at,lastMessageBody:row.last_message_body,lastMessageSenderType:row.last_message_sender_type,unread:row.last_message_sender_type==="tenant"&&(!row.owner_last_read_at||row.owner_last_read_at<row.last_message_at)})),
      workOrders:(workOrderResult.data||[]).map(order=>({...order,messagesUnread:(conversationResult.data||[]).some(row=>row.work_order_id===order.id&&row.last_message_sender_type==="tenant"&&(!row.owner_last_read_at||row.owner_last_read_at<row.last_message_at))})) });
  } catch (error) {
    console.error("Rental Manager query error", error);
    return NextResponse.json({ error: "Unable to load open rent charges." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const authenticated = await createAuthenticatedRentalManagerApplication();
    if (authenticated.response) return authenticated.response;
    const body = await request.json();
    const { application, user, effectiveOwnerId } = authenticated;
    const timestamp = now();
    // Strict own-key dispatch: only a string operation that is a registered
    // table key reaches a handler. Inherited/prototype names ("constructor",
    // "toString", "__proto__", "hasOwnProperty") and non-string operations
    // fall through to the unknown-operation 400, as the pre-split switch did.
    const operation = body?.operation;
    const handler = typeof operation === "string" && Object.hasOwn(OPERATION_HANDLERS, operation)
      ? OPERATION_HANDLERS[operation]
      : undefined;
    if (!handler) return badRequest("A supported Rental Manager operation is required.");
    return await handler({ authenticated, body, application, user, effectiveOwnerId, timestamp });
  } catch (error) {
    console.error("Rental Manager operation error", error);
    const message = error?.code === "23505"
      ? "A record with that same identity already exists (e.g. a tenant with this email, or a duplicate lease import)."
      : error?.message || "Unable to complete Rental Manager operation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
