const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const direction = (type) => ["received", "adjustment_increase"].includes(type) ? 1 : -1;
export function heldDepositBalance(depositId, transactions = []) {
  return transactions.filter((item) => item.depositId === depositId)
    .reduce((sum, item) => sum + direction(item.transactionType) * item.amountCents, 0);
}
export default function TenantDepositPanel({ rentals }) {
  const deposits = rentals.flatMap((rental) => (rental.securityDeposits || []).map((deposit) => ({
    ...deposit, unitLabel: rental.unit?.label || "Rental home",
    transactions: (rental.securityDepositTransactions || []).filter((item) => item.depositId === deposit.id),
  })));
  if (!deposits.length) return null;
  return <section className="rounded-2xl border bg-white p-6 shadow-sm"><p className="text-sm font-bold uppercase tracking-widest text-amber-700">Security deposit</p>
    <h2 className="mt-2 text-xl font-black">Deposit balance and history</h2>
    <p className="mt-2 text-sm text-slate-600">Your security deposit is tracked separately from rent. It does not pay a rent balance unless a documented, lawful disposition is recorded.</p>
    <div className="mt-5 space-y-4">{deposits.map((deposit) => <article key={deposit.id} className="rounded-xl border p-4">
      <div className="flex justify-between gap-4"><div><p className="font-bold">{deposit.unitLabel}</p><p className="text-sm capitalize text-slate-500">{deposit.status.replaceAll("_", " ")}{deposit.jurisdictionCode ? ` · ${deposit.jurisdictionCode}` : ""}</p></div>
        <div className="text-right"><p className="text-sm text-slate-500">Currently held</p><p className="text-xl font-black">{money.format(heldDepositBalance(deposit.id, deposit.transactions) / 100)}</p><p className="text-xs text-slate-500">Required {money.format(deposit.requiredAmountCents / 100)}</p></div></div>
      {deposit.transactions.length ? <div className="mt-4 border-t pt-3">{deposit.transactions.map((item) => <div key={item.id} className="flex justify-between gap-3 py-1 text-sm"><span><span className="capitalize">{item.transactionType.replaceAll("_", " ")}</span> · {date.format(new Date(item.occurredAt))}<br/><span className="text-slate-500">{item.description}</span></span><strong>{direction(item.transactionType) < 0 ? "−" : "+"}{money.format(item.amountCents / 100)}</strong></div>)}</div> : <p className="mt-4 text-sm text-slate-500">No deposit funds have been recorded yet.</p>}
    </article>)}</div></section>;
}
