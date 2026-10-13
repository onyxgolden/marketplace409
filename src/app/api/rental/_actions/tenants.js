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

export async function setPrimaryTenant({ authenticated, body, effectiveOwnerId }) {
  if (!body.leaseId || !body.tenantId) return badRequest("leaseId and tenantId are required.");
  const { error } = await authenticated.supabaseClient.rpc("set_rental_primary_tenant", {
    p_owner_id: effectiveOwnerId, p_lease_id: body.leaseId, p_tenant_id: body.tenantId,
  });
  if (error) throw error;
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
  return NextResponse.json({ success: true, review: data });
}
