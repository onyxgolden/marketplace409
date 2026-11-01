import { NextResponse } from "next/server";
import { badRequest, id, readOnlyWriteBlocked } from "./shared.js";

export async function updateMaintenanceRequest({ authenticated, body, effectiveOwnerId, timestamp }) {
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

export async function createMaintenanceRequest({ authenticated, body, effectiveOwnerId }) {
  // Controls-sweep follow-up G19 (O-05): the landlord path for a
  // phone-reported issue. The tenant portal RPC cannot serve it — it
  // resolves the tenant from auth.uid() and rejects a landlord session —
  // so this inserts owner-side. The request is filed against the lease's
  // household: primary tenant, else the first member. The lease must be
  // active, matching the tenant RPC's gate.
  const input = body.request || {};
  if (typeof input.leaseId !== "string" || input.leaseId.trim() === "")
    return badRequest("A lease is required.");
  if (typeof input.title !== "string" || input.title.trim() === "")
    return badRequest("A maintenance request title is required.");
  if (typeof input.description !== "string" || input.description.trim() === "")
    return badRequest("A maintenance request description is required.");
  const priority = ["routine", "soon", "urgent", "emergency"].includes(input.priority) ? input.priority : "routine";
  const { data: lease, error: leaseError } = await authenticated.supabaseClient.from("rental_leases")
    .select("id, unit_id, status").eq("owner_id", effectiveOwnerId).eq("id", input.leaseId.trim()).maybeSingle();
  if (leaseError) throw leaseError;
  if (!lease) return NextResponse.json({ error: "Lease was not found." }, { status: 404 });
  if (lease.status !== "active")
    return NextResponse.json({ error: "Maintenance requests can only be filed against an active lease." }, { status: 409 });
  const { data: members, error: memberError } = await authenticated.supabaseClient.from("rental_lease_tenants")
    .select("tenant_id, occupancy_role").eq("owner_id", effectiveOwnerId).eq("lease_id", lease.id);
  if (memberError) throw memberError;
  const tenantId = (members || []).find((row) => row.occupancy_role === "primary")?.tenant_id
    || (members || [])[0]?.tenant_id;
  if (!tenantId)
    return NextResponse.json({ error: "The lease has no tenants to file the request against." }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("rental_maintenance_requests").insert({
    owner_id: effectiveOwnerId, id: id("rental_maintenance", input.id), lease_id: lease.id, unit_id: lease.unit_id,
    tenant_id: tenantId, title: input.title.trim(), description: input.description.trim(), priority,
    status: "submitted", permission_to_enter: input.permissionToEnter === true,
    contact_phone: typeof input.contactPhone === "string" ? input.contactPhone.trim() || null : null,
  }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, request: data });
}

export async function updateContractor({ authenticated, body, effectiveOwnerId }) {
  // Controls-sweep follow-up G19 (O-06): save-contractor was insert-only,
  // so a typo'd phone/trade could never be fixed. Same validators as the
  // insert; status is not editable here (see setContractorStatus).
  const input = body.contractor || {};
  if (!input?.id) return badRequest("Contractor id is required.");
  if (!input?.businessName?.trim()) return badRequest("Contractor business name is required.");
  const taxLast4 = input.taxIdLast4?.trim() || null;
  if (taxLast4 && !/^\d{4}$/.test(taxLast4)) return badRequest("Tax ID last four must contain four digits.");
  const { data, error } = await authenticated.supabaseClient.from("rental_contractors").update({
    business_name: input.businessName.trim(), contact_name: input.contactName?.trim() || null,
    email: input.email?.trim() || null, phone: input.phone?.trim() || null,
    trade: input.trade?.trim() || null, license_reference: input.licenseReference?.trim() || null,
    insurance_expiration: input.insuranceExpiration || null, w9_status: input.w9Status || "not_requested",
    tax_classification: input.taxClassification?.trim() || null, tax_id_last4: taxLast4,
  }).eq("owner_id", effectiveOwnerId).eq("id", input.id).select("*").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Contractor was not found." }, { status: 404 });
  return NextResponse.json({ success: true, contractor: data });
}

async function setContractorStatus({ authenticated, body, effectiveOwnerId }, status) {
  // Controls-sweep follow-up G19 (O-06): deactivation is what makes the
  // work-order form's `status === "active"` filter meaningful — a retired
  // contractor stops being assignable. Reactivation is the symmetric undo
  // so a mistaken deactivation is not a one-way trap.
  if (!body?.contractorId) return badRequest("Contractor id is required.");
  const { data, error } = await authenticated.supabaseClient.from("rental_contractors").update({ status })
    .eq("owner_id", effectiveOwnerId).eq("id", body.contractorId).select("id, status").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Contractor was not found." }, { status: 404 });
  return NextResponse.json({ success: true, contractor: data });
}

export async function deactivateContractor(args) { return setContractorStatus(args, "inactive"); }
export async function reactivateContractor(args) { return setContractorStatus(args, "active"); }

export async function saveContractor({ authenticated, body, effectiveOwnerId }) {
  const input = body.contractor;
  if (!input?.businessName?.trim()) return badRequest("Contractor business name is required.");
  const taxLast4 = input.taxIdLast4?.trim() || null;
  if (taxLast4 && !/^\d{4}$/.test(taxLast4)) return badRequest("Tax ID last four must contain four digits.");
  const { data, error } = await authenticated.supabaseClient.from("rental_contractors").insert({
    owner_id: effectiveOwnerId, id: id("rental_contractor", input.id), business_name: input.businessName.trim(),
    contact_name: input.contactName?.trim() || null, email: input.email?.trim() || null, phone: input.phone?.trim() || null,
    status: "active", trade: input.trade?.trim() || null, license_reference: input.licenseReference?.trim() || null,
    insurance_expiration: input.insuranceExpiration || null, w9_status: input.w9Status || "not_requested",
    tax_classification: input.taxClassification?.trim() || null, tax_id_last4: taxLast4,
  }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, contractor: data });
}

export async function recordContractorPayment({ authenticated, body, effectiveOwnerId }) {
  const input = body.payment;
  const amount = Number(input?.amountCents);
  if (!input?.contractorId || !input?.propertyId || !input?.paidAt || !Number.isSafeInteger(amount) || amount <= 0)
    return badRequest("Contractor, property, payment date, and positive amount are required.");
  const { data, error } = await authenticated.supabaseClient.rpc("record_rental_contractor_payment", {
    p_owner_id: effectiveOwnerId, p_contractor_id: input.contractorId, p_work_order_id: input.workOrderId || null,
    p_property_id: input.propertyId, p_paid_at: input.paidAt, p_amount_cents: amount,
    p_payment_method: input.paymentMethod, p_reference: input.reference || null,
    p_invoice_reference: input.invoiceReference || null, p_invoice_document_id: input.invoiceDocumentId || null,
    p_notes: input.notes || null,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, payment: data });
}

export async function updateSupportCase({ authenticated, body, effectiveOwnerId }) {
  if (!body.caseId || !["open", "investigating", "waiting_on_tenant", "waiting_on_provider", "resolved", "closed"].includes(body.status))
    return badRequest("Case and supported status are required.");
  if (["resolved", "closed"].includes(body.status) && !body.resolution?.trim())
    return badRequest("A resolution is required before resolving or closing a case.");
  const { data, error } = await authenticated.supabaseClient.rpc("update_rental_support_case", {
    p_owner_id: effectiveOwnerId, p_case_id: body.caseId, p_status: body.status,
    p_public_note: body.publicNote || null, p_private_note: body.privateNote || null, p_resolution: body.resolution || null,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, supportCase: data });
}

// Controls-sweep follow-up G25 (O-20): manual case creation for a
// tenant-reported issue that never auto-created a case (auto-cases only
// come from failed/disputed/refunded payments). Tenant is optional — a
// general issue has no tenant — but when given it must belong to the owner.
export async function createSupportCase({ authenticated, body, effectiveOwnerId }) {
  if (await readOnlyWriteBlocked(authenticated)) return NextResponse.json({ error: "Read-only members cannot open support cases." }, { status: 403 });
  const input = body.supportCase || {};
  if (typeof input.title !== "string" || input.title.trim() === "")
    return badRequest("A case title is required.");
  if (!["failed_payment", "refund_request", "payment_dispute", "portal_access", "maintenance_escalation", "other"].includes(input.caseType || "other"))
    return badRequest("A supported case type is required.");
  if (!["normal", "high", "urgent"].includes(input.priority || "normal"))
    return badRequest("A supported priority is required.");
  if (input.tenantId) {
    const { data: tenant, error: tenantError } = await authenticated.supabaseClient.from("rental_tenants")
      .select("id").eq("owner_id", effectiveOwnerId).eq("id", input.tenantId).maybeSingle();
    if (tenantError) throw tenantError;
    if (!tenant) return NextResponse.json({ error: "Tenant was not found." }, { status: 404 });
  }
  const caseId = id("rental_support_case", input.id);
  const { data, error } = await authenticated.supabaseClient.from("rental_support_cases").insert({
    owner_id: effectiveOwnerId, id: caseId, tenant_id: input.tenantId || null,
    lease_id: input.leaseId || null, case_type: input.caseType || "other",
    priority: input.priority || "normal", status: "open", title: input.title.trim(),
    tenant_visible_summary: input.summary?.trim() ? input.summary.trim() : null,
    private_owner_note: input.privateNote?.trim() ? input.privateNote.trim() : null,
    created_by: authenticated.user.id,
  }).select("*").single();
  if (error) throw error;
  await authenticated.supabaseClient.from("rental_support_case_events").insert({
    owner_id: effectiveOwnerId, id: id("rental_support_event", null), case_id: caseId,
    event_type: "opened", public_note: input.summary?.trim() || null,
    private_note: input.privateNote?.trim() || null, status: "open", recorded_by: authenticated.user.id,
  });
  return NextResponse.json({ success: true, supportCase: data });
}

export async function createMaintenanceWorkOrder({ authenticated, body, effectiveOwnerId }) {
  const input = body.workOrder;
  if (!input?.requestId || !input?.scopeOfWork?.trim()) return badRequest("Maintenance request and scope of work are required.");
  const estimate = input.estimatedCostCents == null || input.estimatedCostCents === "" ? null : Number(input.estimatedCostCents);
  if (estimate !== null && (!Number.isSafeInteger(estimate) || estimate < 0))
    return badRequest("Estimated cost must be a nonnegative whole number of cents.");
  const { data, error } = await authenticated.supabaseClient.rpc("create_rental_maintenance_work_order", {
    p_owner_id: effectiveOwnerId,
    p_work_order: { ...input, id: id("rental_work_order", input.id), scopeOfWork: input.scopeOfWork.trim(), estimatedCostCents: estimate },
  });
  if (error) throw error;
  return NextResponse.json({ success: true, workOrder: data });
}

export async function updateMaintenanceWorkOrder({ authenticated, body, effectiveOwnerId }) {
  const input = body.workOrder;
  if (!input?.id) return badRequest("workOrder id is required.");
  const cents = (value) => value === null || value === undefined ? null : Number(value);
  const { data, error } = await authenticated.supabaseClient.rpc("update_rental_maintenance_work_order", {
    p_owner_id: effectiveOwnerId, p_work_order_id: input.id, p_status: input.status,
    p_scheduled_start: input.scheduledStart || null, p_scheduled_end: input.scheduledEnd || null,
    p_estimated_cost_cents: cents(input.estimatedCostCents), p_actual_cost_cents: cents(input.actualCostCents),
    p_invoice_reference: input.invoiceReference || null, p_invoice_document_id: input.invoiceDocumentId || null,
    p_completion_document_id: input.completionDocumentId || null, p_public_note: input.publicNote || null,
    p_private_note: input.privateNote || null,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, workOrder: data });
}
