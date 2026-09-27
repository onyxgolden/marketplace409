// Row mapper: a validated transaction value (see validateTransaction) becomes
// a financial_events insert row. Shared by the single-transaction route and
// the batch-expense route so both write identical rows.
export function toRow({ ownerId, userId, value }) {
  return {
    owner_id: ownerId,
    property_id: value.propertyId,
    event_date: value.eventDate,
    description: value.description,
    amount: value.amount,
    transaction_kind: value.transactionKind,
    normalized_category: value.normalizedCategory,
    payee: value.payee,
    check_number: value.checkNumber,
    bank_account_id: value.bankAccountId,
    cleared: value.cleared,
    cleared_at: value.cleared ? new Date().toISOString() : null,
    display_as: value.displayAs,
    ref_number: value.refNumber,
    payee_mailing_address: value.payeeMailingAddress,
    assigned_to: value.assignedTo,
    is_recurring: value.isRecurring,
    recurrence_rule: value.recurrenceRule,
    depreciate: value.depreciate,
    tax_deductible: value.transactionKind === "expense",
    affects_noi: true,
    capitalized: false,
    source_system: "manual",
    metadata: {
      ...(value.memo ? { memo: value.memo } : {}),
      ...(value.tenantId ? { tenant_id: value.tenantId, charged_to_tenant: value.chargeTenant } : {}),
      ...(value.paymentMethod ? { payment_method: value.paymentMethod } : {}),
    },
    status: "active",
    is_deleted: false,
    created_by: userId,
    updated_by: userId,
  };
}
