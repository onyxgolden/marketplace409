const label = value => String(value || "unknown").replaceAll("_", " ");
const money = (value, currency) => value == null ? "Unknown" : new Intl.NumberFormat("en-US", {
  style: "currency", currency: currency || "USD",
}).format(Number(value) / 100);

export default function ReservationFinanceDetails({ financial }) {
  if (!financial) return null;
  const entries = [
    ["Refund", label(financial.refundStatus)],
    ["Refunded amount", money(financial.bookingRefundedCents, financial.currencyCode)],
    ["Reversed amount", money(financial.reversedCents, financial.currencyCode)],
    ["Dispute", label(financial.disputeStatus)],
    ["Original Stripe gross", money(financial.grossCents, financial.currencyCode)],
    ["Original Stripe fee", money(financial.feeCents, financial.currencyCode)],
    ["Original Stripe net", money(financial.netCents, financial.currencyCode)],
    ["Payout", label(financial.payoutStatus)],
    ["Historically paid out", money(financial.paidOutAmountCents, financial.currencyCode)],
    ["Reconciliation", label(financial.reconciliationStatus)],
  ];
  return <section aria-label="Refund, dispute and payout status" className="mt-3 text-sm">
    <dl className="grid grid-cols-2 gap-2">{entries.map(([title, value]) => <div key={title} className="contents">
      <dt>{title}</dt><dd className="text-right font-bold capitalize">{value}</dd>
    </div>)}</dl>
    <p className="mt-3">Payment confirmation, refunds, disputes, settlement and payout are separate. Historical settlement amounts are not the current spendable balance.</p>
    {financial.reconciliationStatus === "unknown" && <p role="status" className="mt-2 font-bold">A provider outcome needs review. Availability and payout cannot be inferred from payment confirmation.</p>}
  </section>;
}
