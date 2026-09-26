import { NextResponse } from "next/server";
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { createRentalUnit } from "@/domains/rental-unit";
import { createRentalTenant } from "@/domains/rental-tenant";
import { createRentalLease } from "@/domains/rental-lease";
import { createRentSchedule } from "@/domains/rent-schedule";
import { fetchAllOwnerFinancialEvents } from "@/domains/rentec-financial-history-import/fetchAllOwnerFinancialEvents";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { buildTenantInviteEmail, buildTenantInviteIdempotencyKey, fingerprintString } from "@/domains/rental-tenant/tenantInviteEmail";

function badRequest(message) { return NextResponse.json({ error: message }, { status: 400 }); }
function now() { return new Date().toISOString(); }
function id(prefix, supplied) { return supplied?.trim() || `${prefix}_${crypto.randomUUID()}`; }

// A read_only workspace member is blocked outright on lease/schedule writes: the role name
// promises no writes, so the write must not happen even though scoping alone would only
// divert it into the actor's own fallback workspace. Non-members (no membership row) keep
// the scoping behavior -- their writes land under their own id and can never touch this
// workspace. See getActiveWorkspaceRole.js for why the lookup is by actor, not by owner.
async function readOnlyWriteBlocked(authenticated) {
  return (await getActiveWorkspaceRole({
    supabaseClient: authenticated.supabaseClient,
    actorUserId: authenticated.user.id,
  })) === "read_only";
}

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
    const [chargesResult, unitsResult, tenantsResult, schedulesResult, maintenanceResult, notificationResult, paymentResult, settlementResult, depositResult, depositTransactionResult, inspectionResult, inspectionItemResult, inspectionAckResult, leaseResult, membershipResult, leaseChangeResult, lateRuleResult, lateAssessmentResult, contractorResult, workOrderResult, workEventResult, leasePreparationResult, leasePreparationVersionResult, leaseSignatureResult, autopayResult, insurancePolicyResult, insuranceRequirementResult, animalResult, supportResult, financialEventResult, conversationResult] = await Promise.all([
      authenticated.supabaseClient.from("rent_charges")
        .select("id, lease_id, schedule_id, period, due_date, amount_cents, paid_amount_cents, currency_code, status, charge_type, related_charge_id")
        .in("status", ["scheduled", "due", "partially_paid", "overdue"]).order("due_date", { ascending: true }),
      authenticated.supabaseClient.from("rental_units")
        .select("id, property_id, label, status, photo_bucket, photo_object_path").order("label", { ascending: true }),
      authenticated.supabaseClient.from("rental_tenants")
        .select("id, display_name, email, phone, work_phone, employer_name, employer_phone, monthly_income_cents, emergency_contact_name, emergency_contact_phone, application_status, application_submitted_at, screening_provider, screening_reference, screening_status, screening_completed_at, ssn_last_four, landlord_notes, status, invited_at, auth_user_id, photo_bucket, photo_object_path").order("display_name", { ascending: true }),
      authenticated.supabaseClient.from("rent_schedules")
        .select("id, lease_id, status, amount_cents, currency_code, due_day, effective_start_date, effective_end_date, collection_mode, collection_provider, forge_cutover_date")
        .order("effective_start_date", { ascending: false }),
      authenticated.supabaseClient.from("rental_maintenance_requests")
        .select("id, lease_id, unit_id, tenant_id, title, description, priority, status, permission_to_enter, contact_phone, owner_notes, submitted_at, updated_at, completed_at")
        .order("submitted_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_notification_outbox")
        .select("id, tenant_id, lease_id, notification_type, channel, recipient, subject, body_text, status, failure_message, scheduled_for, attempt_count, max_attempts, next_attempt_at, created_at, sent_at")
        .order("created_at", { ascending: false }),
      authenticated.supabaseClient.from("rental_payments")
        .select("id, charge_id, lease_id, tenant_id, provider, provider_payment_id, amount_cents, refunded_amount_cents, currency_code, status, payment_method, received_at, succeeded_at, created_at")
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
      authenticated.supabaseClient.from("rental_conversations").select("id, tenant_id, last_message_at, last_message_body, last_message_sender_type, owner_last_read_at, tenant_last_read_at").order("last_message_at",{ascending:false}),
    ]);
    const error = chargesResult.error || unitsResult.error || tenantsResult.error || schedulesResult.error || maintenanceResult.error || notificationResult.error || paymentResult.error || settlementResult.error || depositResult.error || depositTransactionResult.error || inspectionResult.error || inspectionItemResult.error || inspectionAckResult.error || leaseResult.error || membershipResult.error || leaseChangeResult.error || lateRuleResult.error || lateAssessmentResult.error || contractorResult.error || workOrderResult.error || workEventResult.error || leasePreparationResult.error || leasePreparationVersionResult.error || leaseSignatureResult.error || autopayResult.error || insurancePolicyResult.error || insuranceRequirementResult.error || animalResult.error || supportResult.error || financialEventResult.error || conversationResult.error;
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
      openCharges: chargesResult.data || [], collectionSummary, billingEnabled,
      units: unitsWithPhotos, tenants: tenantsWithPhotos, schedules: schedulesResult.data || [],
      maintenanceRequests: maintenanceResult.data || [], notifications: notificationResult.data || [],
      payments: paymentResult.data || [], settlements: settlementResult.data || [], deposits: depositResult.data || [],
      depositTransactions: depositTransactionResult.data || [], inspections: inspectionResult.data || [],
      inspectionItems: inspectionItemResult.data || [], inspectionAcknowledgements: inspectionAckResult.data || [],
      leases:leaseResult.data||[],leaseMemberships:membershipResult.data||[],leaseChanges:leaseChangeResult.data||[],lateFeeRules:lateRuleResult.data||[],lateFeeAssessments:lateAssessmentResult.data||[],contractors:contractorResult.data||[],workOrders:workOrderResult.data||[],workEvents:workEventResult.data||[],leasePreparations:leasePreparationResult.data||[],leasePreparationVersions:leasePreparationVersionResult.data||[],leaseSignatures:leaseSignatureResult.data||[],autopayEnrollments:autopayResult.data||[],insurancePolicies:insurancePolicyResult.data||[],insuranceRequirements:insuranceRequirementResult.data||[],animals:animalResult.data||[],supportCases:supportResult.data||[],financialEvents:financialEventResult.data||[],
      // unread: the tenant sent the most recent message and the owner hasn't read past it yet --
      // never derived from tenant_last_read_at, which says nothing about what the OWNER has seen.
      conversations:(conversationResult.data||[]).map(row=>({id:row.id,tenantId:row.tenant_id,lastMessageAt:row.last_message_at,lastMessageBody:row.last_message_body,lastMessageSenderType:row.last_message_sender_type,unread:row.last_message_sender_type==="tenant"&&(!row.owner_last_read_at||row.owner_last_read_at<row.last_message_at)})) });
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

    switch (body?.operation) {
      case "save-unit": {
        const input = body.unit;
        if (!input || typeof input !== "object") return badRequest("unit is required.");
        if (!input.id) {
          const existing = await application.findUnitsByProperty(input.propertyId, effectiveOwnerId);
          const duplicate = existing.find((item) => item.status !== "inactive" && item.label.trim().toLowerCase() === String(input.label || "").trim().toLowerCase());
          if (duplicate) return NextResponse.json({ error: `${duplicate.label} already exists. Select it to edit the existing property/unit.` }, { status: 409 });
        }
        const unit = createRentalUnit({ ...input, id: id("rental_unit", input.id), createdAt: input.createdAt || timestamp,
          updatedAt: timestamp, bedrooms: input.bedrooms ?? null, bathrooms: input.bathrooms ?? null,
          squareFeet: input.squareFeet ?? null, availableAt: input.availableAt ?? null, notes: input.notes ?? null });
        return NextResponse.json({ success: true, unit: await application.saveUnit(unit, effectiveOwnerId) });
      }
      case "archive-unit": {
        if (typeof body.unitId !== "string" || body.unitId.trim() === "") return badRequest("unitId is required.");
        const unit = await application.units.findById(body.unitId.trim(), effectiveOwnerId);
        if (!unit) return NextResponse.json({ error: "Property/unit not found." }, { status: 404 });
        const { data: activeLeases, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
          .select("id").eq("owner_id", effectiveOwnerId).eq("unit_id", unit.id).eq("status", "active").limit(1);
        if (leaseError) throw leaseError;
        if (activeLeases?.length) return NextResponse.json({ error: "End or transfer the active lease before archiving this property/unit." }, { status: 409 });
        const archived = createRentalUnit({ ...unit, status: "inactive", updatedAt: timestamp });
        return NextResponse.json({ success: true, unit: await application.saveUnit(archived, effectiveOwnerId) });
      }
      case "delete-archived-unit": {
        if (typeof body.unitId !== "string" || body.unitId.trim() === "") return badRequest("unitId is required.");
        const unitId = body.unitId.trim();
        const unit = await application.units.findById(unitId, effectiveOwnerId);
        if (!unit) return NextResponse.json({ error: "Property/unit not found." }, { status: 404 });
        if (unit.status !== "inactive") return NextResponse.json({ error: "Archive the duplicate before permanently deleting it." }, { status: 409 });
        const referenceTables = ["rental_leases", "rental_maintenance_requests", "rental_inspections"];
        const referenceResults = await Promise.all(referenceTables.map((table) => authenticated.supabaseClient.from(table)
          .select("id").eq("owner_id", effectiveOwnerId).eq("unit_id", unitId).limit(1)));
        const referenceError = referenceResults.find((result) => result.error)?.error;
        if (referenceError) throw referenceError;
        if (referenceResults.some((result) => result.data?.length)) return NextResponse.json({
          error: "This archived property/unit has linked lease, maintenance, or inspection history and cannot be permanently deleted.",
        }, { status: 409 });
        const { data, error } = await authenticated.supabaseClient.from("rental_units").delete()
          .eq("owner_id", effectiveOwnerId).eq("id", unitId).eq("status", "inactive").select("id, label").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Archived property/unit was not found." }, { status: 404 });
        return NextResponse.json({ success: true, deletedUnit: data });
      }
      case "review-animal": {if(!body.animalId||!["approved","denied"].includes(body.decision)||!body.classification||!body.approvalEvidenceId)return badRequest("Animal, decision, classification, and evidence are required.");const{data,error}=await authenticated.supabaseClient.rpc("review_rental_animal",{p_owner_id:effectiveOwnerId,p_animal_id:body.animalId,p_decision:body.decision,p_classification:body.classification,p_approval_evidence_id:body.approvalEvidenceId,p_monthly_fee_cents:body.monthlyFeeCents??null,p_effective_start_date:body.effectiveStartDate||null});if(error)throw error;return NextResponse.json({success:true,review:data});}
      case "save-tenant": {
        const input = body.tenant;
        if (!input || typeof input !== "object") return badRequest("tenant is required.");
        const normalizedEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
        if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) return badRequest("A valid tenant email is required.");
        const { data: existingTenants, error: existingError } = await authenticated.supabaseClient.from("rental_tenants")
          .select("id, display_name, email, status").eq("owner_id", effectiveOwnerId);
        if (existingError) throw existingError;
        const duplicate = existingTenants?.find((item) => item.email?.trim().toLowerCase() === normalizedEmail);
        if (duplicate) return NextResponse.json({
          error: `${duplicate.display_name} already exists with ${duplicate.email}. The existing tenant has been selected.`,
          existingTenant: duplicate,
        }, { status: 409 });
        const tenant = createRentalTenant({ ...input, id: id("rental_tenant", input.id), authUserId: input.authUserId ?? null,
          email: normalizedEmail, phone: input.phone ?? null, status: input.status ?? "invited", invitedAt: input.invitedAt ?? timestamp,
          activatedAt: input.activatedAt ?? null, createdAt: input.createdAt || timestamp, updatedAt: timestamp });
        return NextResponse.json({ success: true, tenant: await application.saveTenant(tenant, effectiveOwnerId) });
      }
      case "delete-unused-tenant": {
        if (typeof body.tenantId !== "string" || !body.tenantId.trim()) return badRequest("tenantId is required.");
        if (body.confirmation !== "DELETE") return badRequest("Type DELETE to confirm permanent deletion.");
        const tenantId = body.tenantId.trim();
        const { data: tenant, error: tenantError } = await authenticated.supabaseClient.from("rental_tenants")
          .select("id, display_name, email, auth_user_id").eq("owner_id", effectiveOwnerId).eq("id", tenantId).maybeSingle();
        if (tenantError) throw tenantError;
        if (!tenant) return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
        if (tenant.auth_user_id) return NextResponse.json({ error: "This tenant has claimed portal access and cannot be deleted." }, { status: 409 });
        const references = ["rental_lease_tenants", "rental_payments", "billing_customer_references", "rent_reporting_enrollments",
          "rental_maintenance_requests", "rental_document_acknowledgements", "rental_security_deposits",
          "pet_liability_policies", "rental_notification_outbox", "rental_autopay_enrollments",
          "renters_insurance_policies", "renters_insurance_evidence", "rental_animals", "rental_support_cases", "rental_inspections",
          "rental_inspection_acknowledgements", "rental_notification_preferences"];
        const checks = await Promise.all(references.map((table) => authenticated.supabaseClient.from(table)
          .select("tenant_id").eq("owner_id", effectiveOwnerId).eq("tenant_id", tenantId).limit(1)));
        const checkError = checks.find((result) => result.error)?.error;
        if (checkError) throw checkError;
        if (checks.some((result) => result.data?.length)) return NextResponse.json({
          error: "This tenant is assigned or has rental history. Delete the other, unassigned duplicate instead.",
        }, { status: 409 });
        const { data: deleted, error: deleteError } = await authenticated.supabaseClient.from("rental_tenants").delete()
          .eq("owner_id", effectiveOwnerId).eq("id", tenantId).is("auth_user_id", null)
          .select("id, display_name, email").maybeSingle();
        if (deleteError) throw deleteError;
        if (!deleted) return NextResponse.json({ error: "Unused tenant was not found." }, { status: 404 });
        return NextResponse.json({ success: true, deletedTenant: deleted });
      }
      case "update-tenant-email": {
        if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") return badRequest("tenantId is required.");
        if (typeof body.email !== "string" || !/^\S+@\S+\.\S+$/.test(body.email.trim())) return badRequest("A valid email is required.");
        const { data, error } = await authenticated.supabaseClient.from("rental_tenants")
          .update({ email: body.email.trim().toLowerCase(), updated_at: timestamp })
          .eq("owner_id", effectiveOwnerId).eq("id", body.tenantId.trim()).is("auth_user_id", null)
          .select("id, display_name, email, status").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Only an unlinked tenant email can be changed." }, { status: 409 });
        return NextResponse.json({ success: true, tenant: data });
      }
      case "send-tenant-invite": {
        if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot send tenant invites." }, { status: 403 });
        if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") return badRequest("tenantId is required.");
        const tenantId = body.tenantId.trim();
        // Owner-scoped lookup: a tenant from another workspace resolves to 404,
        // never a 403 that would leak its existence.
        const { data: tenant, error: tenantError } = await authenticated.supabaseClient.from("rental_tenants")
          .select("id, display_name, email, status, auth_user_id").eq("owner_id", effectiveOwnerId).eq("id", tenantId).maybeSingle();
        if (tenantError) throw tenantError;
        if (!tenant) return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
        if (tenant.auth_user_id) return NextResponse.json({ error: "This tenant already has portal access." }, { status: 409 });
        const email = (tenant.email || "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return badRequest("The tenant does not have a valid email address.");

        let leaseSummary = null;
        if (typeof body.leaseId === "string" && body.leaseId.trim() !== "") {
          const leaseId = body.leaseId.trim();
          const { data: link, error: linkError } = await authenticated.supabaseClient.from("rental_lease_tenants")
            .select("lease_id").eq("owner_id", effectiveOwnerId).eq("lease_id", leaseId).eq("tenant_id", tenantId).maybeSingle();
          if (linkError) throw linkError;
          if (!link) return NextResponse.json({ error: "The tenant is not on that lease." }, { status: 409 });
          const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
            .select("unit_id, start_date, monthly_rent_cents").eq("owner_id", effectiveOwnerId).eq("id", leaseId).maybeSingle();
          if (leaseError) throw leaseError;
          if (lease) {
            const { data: unit, error: unitError } = await authenticated.supabaseClient.from("rental_units")
              .select("label").eq("owner_id", effectiveOwnerId).eq("id", lease.unit_id).maybeSingle();
            if (unitError) throw unitError;
            leaseSummary = { unitLabel: unit?.label || "your rental", monthlyRentCents: lease.monthly_rent_cents, startDate: lease.start_date };
          }
        }

        const asOfDate = timestamp.slice(0, 10);
        const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://marketplace409.vercel.app").replace(/\/$/, "");
        const rendered = buildTenantInviteEmail({
          tenantName: tenant.display_name, tenantEmail: email, leaseSummary,
          portalUrl: `${siteUrl}/forge/rental/portal`,
        });
        // The recipient always comes from the owner's own tenant record — never
        // free-form input — so this endpoint cannot be repurposed as a relay.
        // The per-day-per-invitation idempotency key is forwarded as the
        // provider idempotency key: a double click or retried request resolves
        // to a single email, while a corrected email or lease summary gets a
        // fresh key and actually sends.
        try {
          await createResendRentalEmailProvider().send({
            id: buildTenantInviteIdempotencyKey({
              tenantId,
              asOfDate,
              payloadFingerprint: fingerprintString(`${rendered.subject}\n${rendered.bodyText}`),
            }),
            senderName: "FORGE Rental Manager",
            senderEmail: process.env.RENTAL_EMAIL_SENDER || "rentals@mail.409marketplace.online",
            recipient: email, subject: rendered.subject, bodyText: rendered.bodyText,
          });
        } catch (sendError) {
          console.error("Tenant invite email failed", { tenantId, code: sendError?.name || "unknown" });
          return NextResponse.json({ error: "The invite email could not be sent. Please try again." }, { status: 502 });
        }
        // invited_at is a UI convenience ("Invite sent <date>"), not the
        // delivery ledger: a failed send never reaches this update.
        const { error: updateError } = await authenticated.supabaseClient.from("rental_tenants")
          .update({ invited_at: timestamp, updated_at: timestamp }).eq("owner_id", effectiveOwnerId).eq("id", tenantId);
        if (updateError) throw updateError;
        return NextResponse.json({ success: true, tenantId, invitedAt: timestamp });
      }
      case "update-tenant-profile": {
        if (typeof body.tenantId !== "string" || body.tenantId.trim() === "") return badRequest("tenantId is required.");
        const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
        const optional = (value) => typeof value === "string" ? value.trim() || null : null;
        const lastFour = optional(profile.ssnLastFour);
        if (lastFour && !/^\d{4}$/.test(lastFour)) return badRequest("SSN last four must contain exactly four digits.");
        const monthlyIncomeCents = profile.monthlyIncomeCents === null || profile.monthlyIncomeCents === "" || profile.monthlyIncomeCents === undefined
          ? null : Number(profile.monthlyIncomeCents);
        if (monthlyIncomeCents !== null && (!Number.isSafeInteger(monthlyIncomeCents) || monthlyIncomeCents < 0)) return badRequest("Monthly income must be a non-negative whole-cent amount.");
        // date_of_birth is deliberately never written here, even if a caller sends dateOfBirth --
        // FORGE does not collect tenant birth dates (owner privacy decision). Omitting the key
        // entirely means Supabase's .update() never touches that column, so any birth date already
        // stored on a legacy record is left exactly as-is, neither erased nor overwritten.
        const update = { phone: optional(profile.phone), work_phone: optional(profile.workPhone),
          employer_name: optional(profile.employerName), employer_phone: optional(profile.employerPhone), monthly_income_cents: monthlyIncomeCents,
          emergency_contact_name: optional(profile.emergencyContactName), emergency_contact_phone: optional(profile.emergencyContactPhone),
          application_status: optional(profile.applicationStatus), application_submitted_at: optional(profile.applicationSubmittedAt),
          screening_provider: optional(profile.screeningProvider), screening_reference: optional(profile.screeningReference),
          screening_status: optional(profile.screeningStatus), screening_completed_at: optional(profile.screeningCompletedAt),
          ssn_last_four: lastFour, landlord_notes: optional(profile.landlordNotes), updated_at: timestamp };
        const { data, error } = await authenticated.supabaseClient.from("rental_tenants").update(update)
          .eq("owner_id", effectiveOwnerId).eq("id", body.tenantId.trim()).select("id, display_name").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
        return NextResponse.json({ success: true, tenant: data });
      }
      case "set-primary-tenant": {
        if (!body.leaseId || !body.tenantId) return badRequest("leaseId and tenantId are required.");
        const { error } = await authenticated.supabaseClient.rpc("set_rental_primary_tenant", {
          p_owner_id: effectiveOwnerId, p_lease_id: body.leaseId, p_tenant_id: body.tenantId,
        });
        if (error) throw error;
        return NextResponse.json({ success: true });
      }
      case "save-lease": {
        if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit leases." }, { status: 403 });
        const input = body.lease;
        if (!input || typeof input !== "object") return badRequest("lease is required.");
        const lease = createRentalLease({ ...input, id: id("rental_lease", input.id), status: input.status ?? "draft",
          endDate: input.endDate ?? null, documentEvidenceId: input.documentEvidenceId ?? null,
          activatedAt: input.activatedAt ?? null, endedAt: input.endedAt ?? null,
          createdAt: input.createdAt || timestamp, updatedAt: timestamp, notes: input.notes ?? null });
        return NextResponse.json({ success: true, lease: await application.saveLease(lease, effectiveOwnerId) });
      }
      case "save-schedule": {
        if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit rent schedules." }, { status: 403 });
        const input = body.schedule;
        if (!input || typeof input !== "object") return badRequest("schedule is required.");
        const schedule = createRentSchedule({ ...input, id: id("rent_schedule", input.id), status: input.status ?? "draft",
          effectiveEndDate: input.effectiveEndDate ?? null, createdAt: input.createdAt || timestamp, updatedAt: timestamp });
        return NextResponse.json({ success: true, schedule: await application.saveSchedule(schedule, effectiveOwnerId) });
      }
      case "cancel-lease": {
        if (typeof body.leaseId !== "string" || body.leaseId.trim() === "") return badRequest("leaseId is required.");
        const { data, error } = await authenticated.supabaseClient.from("rental_leases")
          .update({ status: "cancelled", updated_at: timestamp })
          .eq("owner_id", effectiveOwnerId).eq("id", body.leaseId.trim()).eq("status", "draft")
          .select("id, status").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Only a draft lease can be cancelled." }, { status: 409 });
        return NextResponse.json({ success: true, lease: data });
      }
      case "generate-charge": {
        if (!body.scheduleId || !body.period) return badRequest("scheduleId and period are required.");
        const charge = await application.generateMonthlyCharge(body.scheduleId, body.period, effectiveOwnerId);
        if (!charge) return NextResponse.json({ error: "The schedule must be active and effective for the selected month." }, { status: 409 });
        return NextResponse.json({ success: true, charge });
      }
      case "void-charge": {
        if (typeof body.chargeId !== "string" || body.chargeId.trim() === "") return badRequest("chargeId is required.");
        if (typeof body.reason !== "string" || body.reason.trim() === "") return badRequest("A reason is required to void a charge.");
        const { data, error } = await authenticated.supabaseClient.rpc("void_rental_rent_charge",
          { p_owner_id: effectiveOwnerId, p_charge_id: body.chargeId.trim(), p_reason: body.reason.trim() });
        if (error) throw error;
        if (!data || !data.id) return NextResponse.json({ error: "Only a charge with no paid balance, not already voided, and no pending or unreversed payment can be voided." }, { status: 409 });
        return NextResponse.json({ success: true, charge: data });
      }
      case "activate-forge-billing": {
        if (typeof body.scheduleId !== "string" || body.scheduleId.trim() === "") return badRequest("scheduleId is required.");
        if (typeof body.cutoverDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.cutoverDate)) return badRequest("A valid cutoverDate (YYYY-MM-DD) is required.");
        const { data, error } = await authenticated.supabaseClient.rpc("activate_forge_billing_collection", {
          p_owner_id: effectiveOwnerId, p_schedule_id: body.scheduleId.trim(), p_cutover_date: body.cutoverDate,
          p_reconciliation_summary: body.reconciliationSummary && typeof body.reconciliationSummary === "object" ? body.reconciliationSummary : {},
        });
        if (error) throw error;
        return NextResponse.json({ success: true, schedule: data });
      }
      case "set-billing-enabled": {
        if (typeof body.enabled !== "boolean") return badRequest("enabled must be boolean.");
        const { data, error } = await authenticated.supabaseClient.rpc("set_rental_billing_enabled", {
          p_owner_id: effectiveOwnerId, p_enabled: body.enabled,
        });
        if (error) throw error;
        return NextResponse.json({ success: true, settings: data });
      }
      case "activate-lease-schedule": {
        if (!body.scheduleId) return badRequest("scheduleId is required.");
        const { data, error } = await authenticated.supabaseClient.rpc("activate_rental_lease_schedule", {
          p_owner_id: effectiveOwnerId, p_schedule_id: body.scheduleId,
        });
        if (error) throw error;
        return NextResponse.json({ success: true, activation: data });
      }
      case "record-offline-payment": {
        const input = body.payment;
        if (!input?.chargeId || !["cash", "cashiers_check"].includes(input.paymentMethod))
          return badRequest("chargeId and a supported offline payment method are required.");
        const amountCents = Number(input.amountCents);
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return badRequest("A positive payment amount is required.");
        // allowOverpaymentCredit: when true, an amount exceeding the charge's remaining
        // balance is accepted — the applied portion settles the charge and the excess is
        // recorded as an open tenant credit (see rental_tenant_credits) instead of being
        // rejected. Requires the caller's explicit human-gated confirmation (the UI
        // enforces checkbox + CONFIRM); the RPC re-validates everything.
        // tenantId: the tenant the payment (and any credit) is attributed to — validated
        // by the RPC as a member of the charge's lease. idempotencyKey: client-generated
        // per submission intent so a retried POST replays instead of double-recording.
        const tenantId = typeof input.tenantId === "string" && input.tenantId.trim() ? input.tenantId.trim() : null;
        const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim() : null;
        const { data, error } = await authenticated.supabaseClient.rpc("record_offline_rental_payment", {
          p_owner_id: effectiveOwnerId, p_charge_id: input.chargeId, p_payment_method: input.paymentMethod,
          p_amount_cents: amountCents, p_received_at: input.receivedAt,
          p_receipt_reference: input.receiptReference || null, p_notes: input.notes || null,
          p_allow_overpayment_credit: input.allowOverpaymentCredit === true,
          p_tenant_id: tenantId, p_idempotency_key: idempotencyKey,
        });
        if (error) throw error;
        return NextResponse.json({ success: true, payment: data });
      }
      case "apply-tenant-credit": {
        const input = body.credit;
        const amountCents = Number(input?.amountCents);
        if (typeof input?.creditId !== "string" || !input.creditId.trim() || typeof input?.chargeId !== "string" || !input.chargeId.trim())
          return badRequest("creditId and chargeId are required.");
        if (!Number.isSafeInteger(amountCents) || amountCents <= 0) return badRequest("A positive credit amount is required.");
        if (input.ownerConfirmed !== true) return badRequest("Owner confirmation is required to apply a credit.");
        const { data, error } = await authenticated.supabaseClient.rpc("apply_rental_tenant_credit", {
          p_owner_id: effectiveOwnerId, p_credit_id: input.creditId.trim(), p_charge_id: input.chargeId.trim(),
          p_amount_cents: amountCents, p_notes: typeof input.notes === "string" ? input.notes.trim() || null : null,
        });
        if (error) throw error;
        return NextResponse.json({ success: true, application: data });
      }
      case "void-tenant-credit": {
        if (typeof body.creditId !== "string" || !body.creditId.trim()) return badRequest("creditId is required.");
        if (typeof body.reason !== "string" || !body.reason.trim()) return badRequest("A reason is required to void a credit.");
        if (body.ownerConfirmed !== true) return badRequest("Owner confirmation is required to void a credit.");
        const { data, error } = await authenticated.supabaseClient.rpc("void_rental_tenant_credit", {
          p_owner_id: effectiveOwnerId, p_credit_id: body.creditId.trim(), p_reason: body.reason.trim(),
        });
        if (error) throw error;
        return NextResponse.json({ success: true, credit: data });
      }
      case "queue-rent-reminder": {
        if(!body.chargeId||!["rent_reminder","balance_overdue"].includes(body.notificationType)||!body.scheduledFor)return badRequest("Charge, reminder type, and schedule are required.");const attempts=Number(body.maxAttempts);if(!Number.isInteger(attempts)||attempts<1||attempts>5)return badRequest("Retry limit must be between 1 and 5.");const{data,error}=await authenticated.supabaseClient.rpc("queue_rental_balance_reminder",{p_owner_id:effectiveOwnerId,p_charge_id:body.chargeId,p_scheduled_for:body.scheduledFor,p_notification_type:body.notificationType,p_max_attempts:attempts});if(error)throw error;return NextResponse.json({success:true,notification:data});
      }
      case "cancel-rent-notification": {
        if(!body.notificationId)return badRequest("notificationId is required.");const{data,error}=await authenticated.supabaseClient.rpc("cancel_rental_notification",{p_owner_id:effectiveOwnerId,p_notification_id:body.notificationId});if(error)throw error;return NextResponse.json({success:true,notification:data});
      }
      case "queue-insurance-renewals": {const{data,error}=await authenticated.supabaseClient.rpc("queue_renters_insurance_renewal_reminders",{p_owner_id:effectiveOwnerId,p_as_of:body.asOf||new Date().toISOString().slice(0,10)});if(error)throw error;return NextResponse.json({success:true,queued:Number(data||0)});}
      case "update-maintenance-request": {
        if (typeof body.requestId !== "string" || body.requestId.trim() === "") return badRequest("requestId is required.");
        if (!["submitted", "reviewing", "scheduled", "in_progress", "completed", "cancelled"].includes(body.status))
          return badRequest("A supported maintenance status is required.");
        const update = { status: body.status, updated_at: timestamp,
          owner_notes: typeof body.ownerNotes === "string" ? body.ownerNotes.trim() || null : null,
          completed_at: body.status === "completed" ? timestamp : null };
        const { data, error } = await authenticated.supabaseClient.from("rental_maintenance_requests")
          .update(update).eq("owner_id", effectiveOwnerId).eq("id", body.requestId.trim())
          .select("id, status, owner_notes, updated_at, completed_at").maybeSingle();
        if (error) throw error;
        if (!data) return NextResponse.json({ error: "Maintenance request was not found." }, { status: 404 });
        return NextResponse.json({ success: true, request: data });
      }
      case "save-security-deposit": {
        const input=body.deposit;const amountCents=Number(input?.requiredAmountCents);
        if(!input?.leaseId||!input?.tenantId||!Number.isSafeInteger(amountCents)||amountCents<0)return badRequest("Lease, tenant, and a nonnegative required deposit are required.");
        const depositId=id("rental_deposit",input.id);const {data,error}=await authenticated.supabaseClient.from("rental_security_deposits").insert({
          owner_id:effectiveOwnerId,id:depositId,lease_id:input.leaseId,tenant_id:input.tenantId,required_amount_cents:amountCents,currency_code:"USD",
          status:"required",jurisdiction_code:input.jurisdictionCode||null,received_deadline:input.receivedDeadline||null,
          disposition_deadline:input.dispositionDeadline||null,updated_at:timestamp}).select("*").single();
        if(error)throw error;return NextResponse.json({success:true,deposit:data});
      }
      case "record-security-deposit-transaction": {
        const input=body.transaction;const amountCents=Number(input?.amountCents);
        if(!input?.depositId||!Number.isSafeInteger(amountCents)||amountCents<=0)return badRequest("Deposit and a positive transaction amount are required.");
        const {data,error}=await authenticated.supabaseClient.rpc("record_rental_security_deposit_transaction",{p_owner_id:effectiveOwnerId,
          p_deposit_id:input.depositId,p_transaction_type:input.transactionType,p_amount_cents:amountCents,p_occurred_at:input.occurredAt,
          p_description:input.description,p_evidence_document_id:input.evidenceDocumentId||null});if(error)throw error;
        return NextResponse.json({success:true,transaction:data});
      }
      case "save-inspection": {
        const input=body.inspection;const items=body.items;
        if(!input?.leaseId||!input?.unitId||!input?.tenantId||!["move_in","move_out","periodic"].includes(input.inspectionType)||!input.inspectionDate)
          return badRequest("Lease, unit, tenant, inspection type, and date are required.");
        if(!Array.isArray(items)||items.length===0||items.some(item=>!item.area?.trim()||!item.component?.trim()||!["excellent","good","fair","poor","damaged","not_inspected"].includes(item.conditionRating)))
          return badRequest("At least one complete inspection item is required.");
        const [{data:lease,error:leaseError},{data:membership,error:membershipError}]=await Promise.all([
          authenticated.supabaseClient.from("rental_leases").select("id, unit_id").eq("owner_id",effectiveOwnerId).eq("id",input.leaseId).maybeSingle(),
          authenticated.supabaseClient.from("rental_lease_tenants").select("tenant_id").eq("owner_id",effectiveOwnerId).eq("lease_id",input.leaseId).eq("tenant_id",input.tenantId).maybeSingle(),
        ]);
        if(leaseError||membershipError)throw leaseError||membershipError;
        if(!lease||lease.unit_id!==input.unitId||!membership)return badRequest("Inspection unit and tenant must belong to the selected lease.");
        const evidenceIds=[...new Set(items.map(item=>item.evidenceDocumentId).filter(Boolean))];
        if(evidenceIds.length){
          const {data:evidence,error:evidenceError}=await authenticated.supabaseClient.from("rental_documents").select("id").eq("owner_id",effectiveOwnerId).eq("lease_id",input.leaseId).in("id",evidenceIds);
          if(evidenceError)throw evidenceError;
          if((evidence||[]).length!==evidenceIds.length)return badRequest("Inspection evidence must be a saved document for the selected lease.");
        }
        const {data,error}=await authenticated.supabaseClient.rpc("save_rental_inspection",{p_owner_id:effectiveOwnerId,p_inspection:input,p_items:items});
        if(error)throw error;return NextResponse.json({success:true,inspection:data});
      }
      case "finalize-inspection": {
        if(typeof body.inspectionId!=="string"||!body.inspectionId.trim())return badRequest("inspectionId is required.");
        const {data,error}=await authenticated.supabaseClient.from("rental_inspections").update({status:"finalized",finalized_at:timestamp,updated_at:timestamp})
          .eq("owner_id",effectiveOwnerId).eq("id",body.inspectionId.trim()).eq("status","draft").select("*").maybeSingle();
        if(error)throw error;if(!data)return NextResponse.json({error:"Draft inspection was not found."},{status:404});
        return NextResponse.json({success:true,inspection:data});
      }
      case "save-lease-change": {
        const input=body.change;if(!input?.leaseId||!["renewal","amendment","proration"].includes(input.changeType)||!input.effectiveDate||!input.reason?.trim())return badRequest("Lease, supported change type, effective date, and reason are required.");
        const {data:lease,error:leaseError}=await authenticated.supabaseClient.from("rental_leases").select("*").eq("owner_id",effectiveOwnerId).eq("id",input.leaseId).maybeSingle();if(leaseError)throw leaseError;if(!lease)return NextResponse.json({error:"Lease was not found."},{status:404});
        const newTerms=input.changeType==="proration"?{amountCents:Number(input.amountCents)}:{monthlyRentCents:Number(input.monthlyRentCents)||lease.monthly_rent_cents,rentDueDay:Number(input.rentDueDay)||lease.rent_due_day,endDate:input.endDate||lease.end_date};
        if(input.changeType==="proration"&&(!Number.isSafeInteger(newTerms.amountCents)||newTerms.amountCents<=0))return badRequest("Proration requires a positive amount.");
        const {data,error}=await authenticated.supabaseClient.from("rental_lease_changes").insert({owner_id:effectiveOwnerId,id:id("rental_lease_change",input.id),lease_id:lease.id,change_type:input.changeType,status:"draft",effective_date:input.effectiveDate,previous_terms:{monthlyRentCents:Number(lease.monthly_rent_cents),rentDueDay:lease.rent_due_day,endDate:lease.end_date},new_terms:newTerms,reason:input.reason.trim(),document_evidence_id:input.documentEvidenceId||null}).select("*").single();if(error)throw error;return NextResponse.json({success:true,change:data});
      }
      case "approve-lease-change": {
        if(!body.changeId)return badRequest("changeId is required.");const {data:approved,error:approvalError}=await authenticated.supabaseClient.from("rental_lease_changes").update({status:"approved",approved_at:timestamp}).eq("owner_id",effectiveOwnerId).eq("id",body.changeId).eq("status","draft").select("id").maybeSingle();if(approvalError)throw approvalError;if(!approved)return NextResponse.json({error:"Draft lease change was not found."},{status:404});const {data,error}=await authenticated.supabaseClient.rpc("apply_rental_lease_change",{p_owner_id:effectiveOwnerId,p_change_id:body.changeId});if(error)throw error;return NextResponse.json({success:true,application:data});
      }
      case "save-late-fee-rule": {
        const input=body.rule;if(!input?.leaseId||!input.jurisdictionCode?.trim()||!input.ruleSource?.trim()||input.manualApprovalConfirmed!==true)return badRequest("Lease, jurisdiction, rule source, and manual-approval confirmation are required.");const graceDays=Number(input.graceDays);if(!Number.isInteger(graceDays)||graceDays<0||graceDays>31)return badRequest("Grace days must be between 0 and 31.");const calculationType=input.calculationType;const fixed=calculationType==="fixed"?Number(input.fixedAmountCents):null;const percentage=calculationType==="percentage"?Number(input.percentageBasisPoints):null;if((calculationType==="fixed"&&(!Number.isSafeInteger(fixed)||fixed<=0))||(calculationType==="percentage"&&(!Number.isInteger(percentage)||percentage<=0)))return badRequest("A valid late-fee calculation is required.");const {data,error}=await authenticated.supabaseClient.from("rental_late_fee_rules").insert({owner_id:effectiveOwnerId,id:id("rental_late_fee_rule",input.id),lease_id:input.leaseId,status:"active",jurisdiction_code:input.jurisdictionCode.trim().toUpperCase(),grace_days:graceDays,calculation_type:calculationType,fixed_amount_cents:fixed,percentage_basis_points:percentage,maximum_amount_cents:input.maximumAmountCents?Number(input.maximumAmountCents):null,rule_source:input.ruleSource.trim(),requires_manual_approval:true}).select("*").single();if(error)throw error;return NextResponse.json({success:true,rule:data});
      }
      case "assess-late-fee": {
        if(!body.ruleId||!body.chargeId||!body.reason?.trim()||body.ownerApproved!==true)return badRequest("Rule, overdue charge, reason, and explicit owner approval are required.");const {data,error}=await authenticated.supabaseClient.rpc("assess_rental_late_fee",{p_owner_id:effectiveOwnerId,p_rule_id:body.ruleId,p_charge_id:body.chargeId,p_reason:body.reason.trim()});if(error)throw error;return NextResponse.json({success:true,assessment:data});
      }
      case "save-contractor": {
        const input=body.contractor;if(!input?.businessName?.trim())return badRequest("Contractor business name is required.");const taxLast4=input.taxIdLast4?.trim()||null;if(taxLast4&&!/^\d{4}$/.test(taxLast4))return badRequest("Tax ID last four must contain four digits.");const {data,error}=await authenticated.supabaseClient.from("rental_contractors").insert({owner_id:effectiveOwnerId,id:id("rental_contractor",input.id),business_name:input.businessName.trim(),contact_name:input.contactName?.trim()||null,email:input.email?.trim()||null,phone:input.phone?.trim()||null,status:"active",trade:input.trade?.trim()||null,license_reference:input.licenseReference?.trim()||null,insurance_expiration:input.insuranceExpiration||null,w9_status:input.w9Status||"not_requested",tax_classification:input.taxClassification?.trim()||null,tax_id_last4:taxLast4}).select("*").single();if(error)throw error;return NextResponse.json({success:true,contractor:data});
      }
      case "record-contractor-payment": {const input=body.payment,amount=Number(input?.amountCents);if(!input?.contractorId||!input?.propertyId||!input?.paidAt||!Number.isSafeInteger(amount)||amount<=0)return badRequest("Contractor, property, payment date, and positive amount are required.");const{data,error}=await authenticated.supabaseClient.rpc("record_rental_contractor_payment",{p_owner_id:effectiveOwnerId,p_contractor_id:input.contractorId,p_work_order_id:input.workOrderId||null,p_property_id:input.propertyId,p_paid_at:input.paidAt,p_amount_cents:amount,p_payment_method:input.paymentMethod,p_reference:input.reference||null,p_invoice_reference:input.invoiceReference||null,p_invoice_document_id:input.invoiceDocumentId||null,p_notes:input.notes||null});if(error)throw error;return NextResponse.json({success:true,payment:data});}
      case "update-support-case": {if(!body.caseId||!["open","investigating","waiting_on_tenant","waiting_on_provider","resolved","closed"].includes(body.status))return badRequest("Case and supported status are required.");if(["resolved","closed"].includes(body.status)&&!body.resolution?.trim())return badRequest("A resolution is required before resolving or closing a case.");const{data,error}=await authenticated.supabaseClient.rpc("update_rental_support_case",{p_owner_id:effectiveOwnerId,p_case_id:body.caseId,p_status:body.status,p_public_note:body.publicNote||null,p_private_note:body.privateNote||null,p_resolution:body.resolution||null});if(error)throw error;return NextResponse.json({success:true,supportCase:data});}
      case "create-maintenance-work-order": {
        const input=body.workOrder;if(!input?.requestId||!input?.scopeOfWork?.trim())return badRequest("Maintenance request and scope of work are required.");const estimate=input.estimatedCostCents==null||input.estimatedCostCents===""?null:Number(input.estimatedCostCents);if(estimate!==null&&(!Number.isSafeInteger(estimate)||estimate<0))return badRequest("Estimated cost must be a nonnegative whole number of cents.");const {data,error}=await authenticated.supabaseClient.rpc("create_rental_maintenance_work_order",{p_owner_id:effectiveOwnerId,p_work_order:{...input,id:id("rental_work_order",input.id),scopeOfWork:input.scopeOfWork.trim(),estimatedCostCents:estimate}});if(error)throw error;return NextResponse.json({success:true,workOrder:data});
      }
      case "update-maintenance-work-order": {
        const input=body.workOrder;if(!input?.id)return badRequest("workOrder id is required.");const cents=value=>value===null||value===undefined?null:Number(value);const {data,error}=await authenticated.supabaseClient.rpc("update_rental_maintenance_work_order",{p_owner_id:effectiveOwnerId,p_work_order_id:input.id,p_status:input.status,p_scheduled_start:input.scheduledStart||null,p_scheduled_end:input.scheduledEnd||null,p_estimated_cost_cents:cents(input.estimatedCostCents),p_actual_cost_cents:cents(input.actualCostCents),p_invoice_reference:input.invoiceReference||null,p_invoice_document_id:input.invoiceDocumentId||null,p_completion_document_id:input.completionDocumentId||null,p_public_note:input.publicNote||null,p_private_note:input.privateNote||null});if(error)throw error;return NextResponse.json({success:true,workOrder:data});
      }
      case "save-lease-preparation-version": {
        const input=body.preparation;if(!input?.leaseId||!input?.title?.trim()||!input?.changeSummary?.trim()||!input.terms||typeof input.terms!=="object"||Array.isArray(input.terms))return badRequest("Lease, title, change summary, and structured terms are required.");
        const {data,error}=await authenticated.supabaseClient.rpc("save_rental_lease_preparation_version",{p_owner_id:effectiveOwnerId,p_lease_id:input.leaseId,p_title:input.title.trim(),p_terms:input.terms,p_change_summary:input.changeSummary.trim()});if(error)throw error;return NextResponse.json({success:true,preparation:data});
      }
      case "approve-lease-preparation-version": {
        const version=Number(body.versionNumber);if(!body.preparationId||!Number.isInteger(version)||version<1||body.ownerApprovalConfirmed!==true)return badRequest("Preparation, version, and explicit owner approval are required.");
        const {data,error}=await authenticated.supabaseClient.rpc("approve_rental_lease_preparation_version",{p_owner_id:effectiveOwnerId,p_preparation_id:body.preparationId,p_version_number:version});if(error)throw error;return NextResponse.json({success:true,preparation:data});
      }
      default:
        return badRequest("A supported Rental Manager operation is required.");
    }
  } catch (error) {
    console.error("Rental Manager operation error", error);
    const message = error?.code === "23505"
      ? "A record with that same identity already exists (e.g. a tenant with this email, or a duplicate lease import)."
      : error?.message || "Unable to complete Rental Manager operation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
