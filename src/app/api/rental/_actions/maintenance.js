import { NextResponse } from "next/server";
import { badRequest, id } from "./shared.js";

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
