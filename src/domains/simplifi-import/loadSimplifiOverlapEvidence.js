const OVERLAP_SOURCES = Object.freeze(["rentec", "rentec_api", "plaid"]);

function signedAmountCents(event) {
  const amountCents = Math.round(Number(event.amount) * 100);
  if (!Number.isFinite(amountCents)) return null;
  if (event.transaction_kind === "income") return Math.abs(amountCents);
  if (event.transaction_kind === "expense") return -Math.abs(amountCents);
  return null;
}

export async function loadSimplifiOverlapEvidence(database, ownerId) {
  const query = database.from("financial_events")
    .select("id,event_date,amount,transaction_kind,normalized_category,source_system")
    .eq("owner_id", ownerId)
    .in("source_system", OVERLAP_SOURCES);
  const { data, error } = await query;
  if (error) throw error;

  return Object.freeze((data ?? []).flatMap((event) => {
    const signedAmount = signedAmountCents(event);
    if (signedAmount === null || !event.id || !event.event_date || !event.normalized_category) return [];
    return [Object.freeze({
      id: event.id,
      event_date: event.event_date,
      signed_amount_cents: signedAmount,
      normalized_category: event.normalized_category,
      source_system: event.source_system,
    })];
  }));
}
