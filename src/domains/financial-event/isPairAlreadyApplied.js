// Pure predicate used by the reconcile-transfers preview: true when every leg of a
// confirmed pair already carries the classification the apply would write. Re-applying
// such a pair is a byte-for-byte no-op, so the preview must stop listing it --
// otherwise the panel never empties and the user keeps re-confirming work that's done
// (the 2026-09-18 debt-payment apply hit exactly this: 12 correctly-applied pairs
// kept reappearing in the preview).
//
// rowById maps event id -> the raw financial_events row ({ transaction_kind,
// normalized_category }). expectedInbound/expectedOutbound are { kind, category }.
export function isPairAlreadyApplied({ inboundId, outboundId, expectedInbound, expectedOutbound, rowById }) {
  const inRow = rowById.get(inboundId);
  const outRow = rowById.get(outboundId);
  return (
    inRow?.transaction_kind === expectedInbound.kind &&
    inRow?.normalized_category === expectedInbound.category &&
    outRow?.transaction_kind === expectedOutbound.kind &&
    outRow?.normalized_category === expectedOutbound.category
  );
}
