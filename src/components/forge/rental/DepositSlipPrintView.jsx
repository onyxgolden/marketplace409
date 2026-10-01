"use client";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatSlipDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : String(isoDate);
}

function formatCents(cents) {
  return money.format(Number(cents || 0) / 100);
}

const TENDER_LABELS = {
  cash: "Cash",
  check: "Checks",
  money_order: "Money orders",
  other: "Other",
};

// Print-ready bank deposit slip: date, account, itemized cash/check lines,
// and the lump total — the shape the bank statement reconciles to. The total
// always equals the sum of the lines (the API enforces it; this view shows it).
export default function DepositSlipPrintView({ deposit, bankAccountName, onClose }) {
  const items = deposit?.items || [];
  const groups = [];
  for (const tender of ["cash", "check", "money_order", "other"]) {
    const lines = items.filter((item) => item.tender === tender);
    if (lines.length > 0) groups.push({ tender, lines });
  }
  const computedTotal = items.reduce((sum, item) => sum + Number(item.amountCents || 0), 0);

  return (
    <div className="bg-white">
      <div className="mb-4 flex items-center justify-between gap-4 print:hidden">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Bank deposit slip</p>
          <h2 className="text-xl font-black">{formatCents(deposit?.totalAmountCents)}</h2>
          <p className="text-sm text-slate-500">
            {formatSlipDate(deposit?.depositDate)} · {bankAccountName || deposit?.bankAccountId}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">
            Close
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-slate-950 px-5 py-2 text-sm font-bold text-white"
          >
            Print slip
          </button>
        </div>
      </div>

      <section
        aria-label="Deposit slip"
        className="border border-slate-300 bg-white p-6 print:border-0 print:p-0"
        style={{ width: "8.5in", maxWidth: "100%" }}
      >
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Deposit slip</p>
            <h3 className="mt-1 text-2xl font-black">{bankAccountName || deposit?.bankAccountId}</h3>
          </div>
          <div className="text-right text-sm leading-tight">
            <p><span className="text-slate-500">Date</span> <span className="font-bold">{formatSlipDate(deposit?.depositDate)}</span></p>
            {deposit?.memo && <p className="mt-1 text-slate-500">{deposit.memo}</p>}
            {deposit?.status === "voided" && (
              <p className="mt-1 font-black uppercase tracking-widest text-red-700">Voided</p>
            )}
          </div>
        </div>

        {groups.map((group) => (
          <div key={group.tender} className="mt-5">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{TENDER_LABELS[group.tender]}</p>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {group.lines.map((line, index) => (
                  <tr key={`${line.eventId}-${index}`} className="border-b border-slate-200">
                    <td className="py-2 pr-4">
                      <p className="font-bold">{line.receivedFrom || "—"}</p>
                      {line.tender === "check" && line.checkNumber && (
                        <p className="text-xs text-slate-500">Check #{line.checkNumber}</p>
                      )}
                    </td>
                    <td className="py-2 text-right font-mono">{formatCents(line.amountCents)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 pr-4 text-right text-xs uppercase tracking-wide text-slate-500">
                    Subtotal {TENDER_LABELS[group.tender].toLowerCase()}
                  </td>
                  <td className="py-2 text-right font-mono font-bold">
                    {formatCents(group.lines.reduce((sum, line) => sum + Number(line.amountCents || 0), 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}

        <div className="mt-6 flex items-center justify-between border-t-2 border-slate-900 pt-4">
          <p className="text-sm font-bold uppercase tracking-widest">Total deposit</p>
          <p className="font-mono text-2xl font-black">{formatCents(deposit?.totalAmountCents)}</p>
        </div>
        <p className="mt-2 text-right text-xs text-slate-500">
          {items.length} receipt{items.length === 1 ? "" : "s"} · lines sum to {formatCents(computedTotal)}
        </p>

        <div className="mt-8 flex items-end justify-between gap-8">
          <div className="w-64">
            <p className="border-b border-slate-800 pb-4 text-sm">&nbsp;</p>
            <p className="text-xs uppercase tracking-wide text-slate-500">Deposited by</p>
          </div>
          <p className="font-mono text-xs text-slate-400 print:hidden">Deposit {deposit?.id}</p>
        </div>
      </section>
    </div>
  );
}
