import { NextResponse } from "next/server";
import { badRequest, id } from "./shared.js";

export async function saveSecurityDeposit({ authenticated, body, effectiveOwnerId, timestamp }) {
  const input = body.deposit;
  const amountCents = Number(input?.requiredAmountCents);
  if (!input?.leaseId || !input?.tenantId || !Number.isSafeInteger(amountCents) || amountCents < 0)
    return badRequest("Lease, tenant, and a nonnegative required deposit are required.");
  const depositId = id("rental_deposit", input.id);
  const { data, error } = await authenticated.supabaseClient.from("rental_security_deposits").insert({
    owner_id: effectiveOwnerId, id: depositId, lease_id: input.leaseId, tenant_id: input.tenantId,
    required_amount_cents: amountCents, currency_code: "USD",
    status: "required", jurisdiction_code: input.jurisdictionCode || null, received_deadline: input.receivedDeadline || null,
    disposition_deadline: input.dispositionDeadline || null, updated_at: timestamp,
  }).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, deposit: data });
}

export async function recordSecurityDepositTransaction({ authenticated, body, effectiveOwnerId }) {
  const input = body.transaction;
  const amountCents = Number(input?.amountCents);
  if (!input?.depositId || !Number.isSafeInteger(amountCents) || amountCents <= 0)
    return badRequest("Deposit and a positive transaction amount are required.");
  const { data, error } = await authenticated.supabaseClient.rpc("record_rental_security_deposit_transaction", {
    p_owner_id: effectiveOwnerId,
    p_deposit_id: input.depositId, p_transaction_type: input.transactionType, p_amount_cents: amountCents,
    p_occurred_at: input.occurredAt,
    p_description: input.description, p_evidence_document_id: input.evidenceDocumentId || null,
  });
  if (error) throw error;
  return NextResponse.json({ success: true, transaction: data });
}
