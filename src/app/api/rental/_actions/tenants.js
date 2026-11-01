import { NextResponse } from "next/server";
import { createRentalTenant } from "@/domains/rental-tenant";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { buildTenantInviteEmail, buildTenantInviteIdempotencyKey, fingerprintString } from "@/domains/rental-tenant/tenantInviteEmail";
import { badRequest, id, readOnlyWriteBlocked } from "./shared.js";

export async function saveTenant({ authenticated, body, application, effectiveOwnerId, timestamp }) {
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

export async function deleteUnusedTenant({ authenticated, body, effectiveOwnerId }) {
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

export async function updateTenantEmail({ authenticated, body, effectiveOwnerId, timestamp }) {
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

export async function sendTenantInvite({ authenticated, body, effectiveOwnerId, timestamp }) {
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

export async function updateTenantProfile({ authenticated, body, effectiveOwnerId, timestamp }) {
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
  // displayName is an optional label-only rename: it never touches the id,
  // email, memberships, or invite state, none of which are in the update
  // object below. When provided it must be a non-empty string (after trim);
  // when absent the stored name is left exactly as-is.
  let displayName;
  if (profile.displayName !== undefined && profile.displayName !== null) {
    if (typeof profile.displayName !== "string" || profile.displayName.trim() === "") return badRequest("Tenant name must not be empty.");
    displayName = profile.displayName.trim();
  }
  const update = { ...(displayName !== undefined ? { display_name: displayName } : {}), phone: optional(profile.phone), work_phone: optional(profile.workPhone),
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

export async function setPrimaryTenant({ authenticated, body, effectiveOwnerId }) {
  if (!body.leaseId || !body.tenantId) return badRequest("leaseId and tenantId are required.");
  // Controls-sweep G1: membership changes on a cancelled lease are refused
  // server-side, not just hidden in the UI — a cancelled lease is terminal.
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", body.leaseId).maybeSingle();
  if (leaseError) throw leaseError;
  if (lease?.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be changed." }, { status: 409 });
  const { error } = await authenticated.supabaseClient.rpc("set_rental_primary_tenant", {
    p_owner_id: effectiveOwnerId, p_lease_id: body.leaseId, p_tenant_id: body.tenantId,
  });
  if (error) throw error;
  return NextResponse.json({ success: true });
}

// Add a second renter to a lease as a co-tenant. Each tenant record holds one
// email, so a second renter is a separate tenant record linked here — never a
// second email on the primary's record. The lease keeps exactly one primary
// (partial unique index); new links are always occupancy_role "co_tenant"
// (CHECK constraint allows only "primary" / "co_tenant").
export async function addCoTenant({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit leases." }, { status: 403 });
  if (!body.leaseId || !body.tenantId) return badRequest("leaseId and tenantId are required.");
  const leaseId = body.leaseId.trim();
  const tenantId = body.tenantId.trim();
  // Owner-scoped lookups: a lease or tenant from another workspace resolves
  // to 404, never a 403 that would leak its existence.
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", leaseId).maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) return NextResponse.json({ error: "Lease was not found." }, { status: 404 });
  // Controls-sweep G1: a cancelled lease is terminal — no membership changes.
  if (lease.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be changed." }, { status: 409 });
  const { data: tenant, error: tenantError } = await authenticated.supabaseClient.from("rental_tenants")
    .select("id, display_name, email").eq("owner_id", effectiveOwnerId).eq("id", tenantId).maybeSingle();
  if (tenantError) throw tenantError;
  if (!tenant) return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
  const { data: existing, error: existingError } = await authenticated.supabaseClient.from("rental_lease_tenants")
    .select("tenant_id, occupancy_role").eq("owner_id", effectiveOwnerId).eq("lease_id", leaseId).eq("tenant_id", tenantId).maybeSingle();
  if (existingError) throw existingError;
  if (existing?.occupancy_role === "primary") return NextResponse.json({ error: `${tenant.display_name} is already the primary tenant on this lease.` }, { status: 409 });
  if (existing) return NextResponse.json({ error: `${tenant.display_name} is already on this lease.` }, { status: 409 });
  const { data: memberships, error: membershipsError } = await authenticated.supabaseClient.from("rental_lease_tenants")
    .select("tenant_id, occupancy_role").eq("owner_id", effectiveOwnerId).eq("lease_id", leaseId);
  if (membershipsError) throw membershipsError;
  if (!memberships?.some((membership) => membership.occupancy_role === "primary")) return NextResponse.json({ error: "Lease has no primary tenant; add a primary tenant first." }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("rental_lease_tenants").insert({
    owner_id: effectiveOwnerId, lease_id: leaseId, tenant_id: tenantId, occupancy_role: "co_tenant",
  }).select("lease_id, tenant_id, occupancy_role").maybeSingle();
  if (error) throw error;
  return NextResponse.json({ success: true, membership: data });
}

// Remove a co-tenant link. The tenant record itself is untouched, so the
// person keeps their email and portal history and can be re-added. The
// primary membership is never deleted here — change the primary first via
// the existing make-primary action, so a lease never ends up primary-less.
export async function removeCoTenant({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot edit leases." }, { status: 403 });
  if (!body.leaseId || !body.tenantId) return badRequest("leaseId and tenantId are required.");
  const leaseId = body.leaseId.trim();
  const tenantId = body.tenantId.trim();
  // Controls-sweep G1: a cancelled lease is terminal — no membership changes.
  // A missing lease row leaves the existing membership checks to answer.
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", leaseId).maybeSingle();
  if (leaseError) throw leaseError;
  if (lease?.status === "cancelled") return NextResponse.json({ error: "A cancelled lease cannot be changed." }, { status: 409 });
  const { data: membership, error: membershipError } = await authenticated.supabaseClient.from("rental_lease_tenants")
    .select("tenant_id, occupancy_role").eq("owner_id", effectiveOwnerId).eq("lease_id", leaseId).eq("tenant_id", tenantId).maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) return NextResponse.json({ error: "Tenant is not on this lease." }, { status: 404 });
  if (membership.occupancy_role === "primary") return NextResponse.json({ error: "The primary tenant cannot be removed from a lease. Change the primary tenant first." }, { status: 409 });
  const { error: deleteError } = await authenticated.supabaseClient.from("rental_lease_tenants").delete()
    .eq("owner_id", effectiveOwnerId).eq("lease_id", leaseId).eq("tenant_id", tenantId);
  if (deleteError) throw deleteError;
  return NextResponse.json({ success: true });
}

export async function reviewAnimal({ authenticated, body, effectiveOwnerId }) {
  if (!body.animalId || !["approved", "denied"].includes(body.decision) || !body.classification || !body.approvalEvidenceId)
    return badRequest("Animal, decision, classification, and evidence are required.");
  const { data, error } = await authenticated.supabaseClient.rpc("review_rental_animal", {
    p_owner_id: effectiveOwnerId, p_animal_id: body.animalId, p_decision: body.decision,
    p_classification: body.classification, p_approval_evidence_id: body.approvalEvidenceId,
    p_monthly_fee_cents: body.monthlyFeeCents ?? null, p_effective_start_date: body.effectiveStartDate || null,
  });
  if (error) throw error;
  // Controls-sweep follow-up G22 (O-12): the review RPC does not end the
  // monthly fee when a pet is denied, so a re-deny of an approved pet
  // would leave an active fee charging. Ending is a no-op for first-time
  // denies (no fee row exists yet). Fee-end first is the safer order in
  // revokeAnimal below; here the RPC already committed, so a fee-end
  // failure is reported, not hidden — the decision stands either way.
  let feeEndError = null;
  if (body.decision === "denied") {
    const { error: feeError } = await authenticated.supabaseClient.from("monthly_pet_fees")
      .update({ status: "ended", effective_end_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
      .eq("owner_id", effectiveOwnerId).eq("animal_id", body.animalId).eq("status", "active");
    if (feeError) feeEndError = feeError.message;
  }
  return NextResponse.json({ success: true, review: data, ...(feeEndError ? { feeEndError } : {}) });
}

// Controls-sweep follow-up G22 (O-12): landlord-side animal creation for a
// phone/paper case. The tenant portal RPC cannot serve it — it resolves
// the tenant from auth.uid() — so this inserts owner-side against an
// active lease's household (primary tenant, else first member). Species
// is dog-only: the schema CHECKs species = 'dog' and the tenant RPC
// hardcodes it, so the form offers no species choice.
export async function createAnimal({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot record animals." }, { status: 403 });
  const input = body.animal || {};
  if (typeof input.leaseId !== "string" || input.leaseId.trim() === "")
    return badRequest("A lease is required.");
  if (typeof input.name !== "string" || input.name.trim() === "")
    return badRequest("The animal's name is required.");
  if (typeof input.breedDescription !== "string" || input.breedDescription.trim() === "")
    return badRequest("A breed description is required.");
  if (!["pet", "assistance_review_requested"].includes(input.requestType))
    return badRequest("Request type must be pet or assistance review.");
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", input.leaseId.trim()).maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) return NextResponse.json({ error: "Lease was not found." }, { status: 404 });
  if (lease.status !== "active")
    return NextResponse.json({ error: "Animals can only be recorded against an active lease." }, { status: 409 });
  const { data: members, error: memberError } = await authenticated.supabaseClient.from("rental_lease_tenants")
    .select("tenant_id, occupancy_role").eq("owner_id", effectiveOwnerId).eq("lease_id", lease.id);
  if (memberError) throw memberError;
  const tenantId = (members || []).find((row) => row.occupancy_role === "primary")?.tenant_id
    || (members || [])[0]?.tenant_id;
  if (!tenantId)
    return NextResponse.json({ error: "The lease has no tenants to record the animal against." }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("rental_animals").insert({
    owner_id: effectiveOwnerId, id: id("rental_animal", input.id), tenant_id: tenantId, lease_id: lease.id,
    name: input.name.trim(), species: "dog", breed_description: input.breedDescription.trim(),
    classification: input.requestType, human_review_required: true, approval_status: "requested",
  }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, animal: data });
}

// Controls-sweep follow-up G22 (O-12): revoke an approved animal outright
// (no new evidence needed — the owner is acting on their own record).
// Fee-end runs FIRST: a denied animal with an active fee would overcharge,
// while an approved animal with an ended fee is recoverable by re-review.
export async function revokeAnimal({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot revoke animals." }, { status: 403 });
  if (!body.animalId) return badRequest("Animal id is required.");
  const { data: animal, error: loadError } = await authenticated.supabaseClient.from("rental_animals")
    .select("id, approval_status").eq("owner_id", effectiveOwnerId).eq("id", body.animalId).maybeSingle();
  if (loadError) throw loadError;
  if (!animal) return NextResponse.json({ error: "Animal was not found." }, { status: 404 });
  if (animal.approval_status !== "approved")
    return NextResponse.json({ error: "Only an approved animal can be revoked." }, { status: 409 });
  const { error: feeError } = await authenticated.supabaseClient.from("monthly_pet_fees")
    .update({ status: "ended", effective_end_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
    .eq("owner_id", effectiveOwnerId).eq("animal_id", body.animalId).eq("status", "active");
  // A fee-end failure aborts before the denial: denied + active fee would
  // overcharge, while approved + active fee is retryable.
  if (feeError) throw feeError;
  const { data, error } = await authenticated.supabaseClient.from("rental_animals")
    .update({ approval_status: "denied", approved_at: null, approved_by: null, approval_evidence_id: null, updated_at: new Date().toISOString() })
    .eq("owner_id", effectiveOwnerId).eq("id", body.animalId).select("id, approval_status").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Animal was not found." }, { status: 404 });
  return NextResponse.json({ success: true, animal: data });
}
