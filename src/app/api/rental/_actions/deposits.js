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

export async function updateSecurityDeposit({ authenticated, body, effectiveOwnerId, timestamp }) {
  // Controls-sweep G6 (M-05): correct a mistyped requirement amount or
  // jurisdiction. The lease/tenant link never changes, and a void or closed
  // requirement cannot be edited — void it and record a new one instead.
  const input = body.deposit;
  const amountCents = Number(input?.requiredAmountCents);
  if (!input?.depositId || !Number.isSafeInteger(amountCents) || amountCents < 0)
    return badRequest("Deposit and a nonnegative required amount are required.");
  const { data: existing, error: lookupError } = await authenticated.supabaseClient.from("rental_security_deposits")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", input.depositId).maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) return NextResponse.json({ error: "Security deposit was not found." }, { status: 404 });
  if (existing.status === "void") return NextResponse.json({ error: "A void deposit requirement cannot be edited." }, { status: 409 });
  if (existing.status === "closed") return NextResponse.json({ error: "A closed deposit requirement cannot be edited." }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("rental_security_deposits")
    .update({ required_amount_cents: amountCents, jurisdiction_code: input.jurisdictionCode || null, updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("id", input.depositId).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, deposit: data });
}

export async function voidSecurityDeposit({ authenticated, body, effectiveOwnerId, timestamp }) {
  // Controls-sweep G6 (M-05): void (never hard-delete) a requirement. The
  // row stays listed with its transaction history. Voiding is refused while
  // money is still held — refund or deduct the held money first — so a void
  // requirement can never hide a live liability.
  if (!body.depositId) return badRequest("depositId is required.");
  const { data: existing, error: lookupError } = await authenticated.supabaseClient.from("rental_security_deposits")
    .select("id, status").eq("owner_id", effectiveOwnerId).eq("id", body.depositId).maybeSingle();
  if (lookupError) throw lookupError;
  if (!existing) return NextResponse.json({ error: "Security deposit was not found." }, { status: 404 });
  if (existing.status === "void") return NextResponse.json({ error: "This deposit requirement is already void." }, { status: 409 });
  const { data: transactions, error: txError } = await authenticated.supabaseClient.from("rental_security_deposit_transactions")
    .select("transaction_type, amount_cents, voided_at").eq("owner_id", effectiveOwnerId).eq("deposit_id", body.depositId);
  if (txError) throw txError;
  const balance = (transactions || []).filter((item) => !item.voided_at)
    .reduce((sum, item) => sum + (["received", "adjustment_increase"].includes(item.transaction_type) ? 1 : -1) * Number(item.amount_cents), 0);
  if (balance !== 0) return NextResponse.json({ error: "Void this requirement only after its held balance is $0 — refund or deduct the held money first." }, { status: 409 });
  const { data, error } = await authenticated.supabaseClient.from("rental_security_deposits")
    .update({ status: "void", updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("id", body.depositId).select("*").single();
  if (error) throw error;
  return NextResponse.json({ success: true, deposit: data });
}

export async function voidSecurityDepositTransaction({ authenticated, body, effectiveOwnerId, timestamp }) {
  // Controls-sweep G6 (M-06): void a recorded transaction with a reason.
  // Nothing is rewritten or deleted: the row stays in the history marked
  // void, the held balance is recomputed without it, and the requirement
  // status follows the same derivation the record RPC uses (never
  // closed-from-void, never resurrected from void). Voiding is refused when
  // it would leave a negative held balance — void the deduction/refund
  // that consumed the money first.
  if (!body.transactionId) return badRequest("transactionId is required.");
  if (typeof body.reason !== "string" || body.reason.trim() === "") return badRequest("A reason is required to void a transaction.");
  const { data: transaction, error: lookupError } = await authenticated.supabaseClient.from("rental_security_deposit_transactions")
    .select("id, deposit_id, transaction_type, amount_cents, voided_at").eq("owner_id", effectiveOwnerId).eq("id", body.transactionId).maybeSingle();
  if (lookupError) throw lookupError;
  if (!transaction) return NextResponse.json({ error: "Deposit transaction was not found." }, { status: 404 });
  if (transaction.voided_at) return NextResponse.json({ error: "This transaction is already void." }, { status: 409 });
  const { data: deposit, error: depositError } = await authenticated.supabaseClient.from("rental_security_deposits")
    .select("id, status, required_amount_cents").eq("owner_id", effectiveOwnerId).eq("id", transaction.deposit_id).maybeSingle();
  if (depositError) throw depositError;
  if (!deposit) return NextResponse.json({ error: "Security deposit was not found." }, { status: 404 });
  if (deposit.status === "void") return NextResponse.json({ error: "Transactions on a void requirement cannot be changed." }, { status: 409 });
  const { data: siblings, error: siblingsError } = await authenticated.supabaseClient.from("rental_security_deposit_transactions")
    .select("transaction_type, amount_cents, voided_at").eq("owner_id", effectiveOwnerId).eq("deposit_id", transaction.deposit_id);
  if (siblingsError) throw siblingsError;
  const signedEffect = (["received", "adjustment_increase"].includes(transaction.transaction_type) ? 1 : -1) * Number(transaction.amount_cents);
  const newBalance = (siblings || []).filter((item) => !item.voided_at)
    .reduce((sum, item) => sum + (["received", "adjustment_increase"].includes(item.transaction_type) ? 1 : -1) * Number(item.amount_cents), 0) - signedEffect;
  if (newBalance < 0) return NextResponse.json({ error: "Voiding this transaction would leave a negative held balance — void the deduction or refund that used this money first." }, { status: 409 });
  const { data: voided, error: voidError } = await authenticated.supabaseClient.from("rental_security_deposit_transactions")
    .update({ voided_at: timestamp, void_reason: body.reason.trim() })
    .eq("owner_id", effectiveOwnerId).eq("id", body.transactionId).select("*").single();
  if (voidError) throw voidError;
  const newStatus = newBalance >= Number(deposit.required_amount_cents) ? "held" : newBalance > 0 ? "partially_held" : "required";
  const { data: updatedDeposit, error: updateError } = await authenticated.supabaseClient.from("rental_security_deposits")
    .update({ status: newStatus, updated_at: timestamp })
    .eq("owner_id", effectiveOwnerId).eq("id", deposit.id).select("*").single();
  if (updateError) throw updateError;
  return NextResponse.json({ success: true, transaction: voided, deposit: updatedDeposit, balanceCents: newBalance });
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
