// Imported Rentec transactions — read-only accounting evidence for the tenant card.
//
// The tenant billing ledger (buildTenantPaymentLedger) deliberately never reads
// financial_events, so a payment can never appear twice (once from rental_payments,
// once from the accounting feed). These Rentec-imported income rows are therefore a
// SEPARATE read model rendered in their own "Imported Rentec Transactions" section,
// segregated from all balance math: every row carries source:'rentec' and
// affectsBalance:false so no future consumer can merge them into a balance.
//
// Attribution is an exact match only. The tenant's source_record_id was set by the
// Rentec migration itself, and the financial-history import stores the Rentec renter
// id in the event metadata — joining the two is using an imported foreign key, not
// a heuristic. The tenant is never guessed: a null/blank renterId yields no rows.
//
// Dedup (provider-scoped payment identity): a row is suppressed only when its
// metadata.rentec_transaction_id — the BARE Rentec transaction id — appears in
// importedPaymentIds, the explicit set of rental_payments.provider_payment_id for
// provider='rentec_external' for this tenant (built by the route, tenant-scoped).
// financial_events.source_record_id is deliberately NOT the dedup key: the import
// writes the COMPOSITE `${transactionId}:${splitId}` there (compositeSourceRecordId
// in rentecFinancialHistoryImportPreview.js), a different ID space — exact-equality
// against it would be a no-op guard that silently suppresses nothing.

const EXCLUDED_STATUSES = new Set(["inactive", "deleted"]);

export function buildImportedRentecHistory({ renterId, events, importedPaymentIds }) {
  const wanted = renterId === null || renterId === undefined ? "" : String(renterId).trim();
  if (!wanted) {
    return { renterId: null, rows: [], totalCents: 0 };
  }
  const imported = importedPaymentIds instanceof Set
    ? importedPaymentIds
    : new Set(importedPaymentIds || []);

  const rows = [];
  for (const event of events || []) {
    if (!event || event.transaction_kind !== "income") continue;
    if (event.is_deleted === true) continue;
    if (EXCLUDED_STATUSES.has(event.status)) continue;
    const metadata = event.metadata || {};
    if (String(metadata.rentec_renter_id ?? "") !== wanted) continue;
    const bareTransactionId = metadata.rentec_transaction_id;
    if (bareTransactionId !== null && bareTransactionId !== undefined && imported.has(String(bareTransactionId))) {
      continue;
    }
    const amountCents = Math.round(Number(event.amount) * 100);
    if (!Number.isFinite(amountCents)) continue;
    rows.push({
      id: event.id,
      eventDate: event.event_date,
      amountCents,
      description: event.description || "",
      category: event.normalized_category || "",
      propertyId: event.property_id || null,
      rentecTransactionId: bareTransactionId === null || bareTransactionId === undefined
        ? null
        : String(bareTransactionId),
      source: "rentec",
      affectsBalance: false,
      attribution: "rentec_renter_id_match",
    });
  }
  rows.sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));
  return {
    renterId: wanted,
    rows,
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}
