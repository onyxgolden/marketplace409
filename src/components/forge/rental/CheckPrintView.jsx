"use client";
import { amountCentsToWords } from "@/application/rental/checkPrinting";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatCheckDate(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  return y && m && d ? `${m}/${d}/${y}` : String(isoDate);
}

function formatCents(cents) {
  return money.format(Number(cents || 0) / 100);
}

// Print-ready check faces for a check run. Each check renders at real check
// proportions (8.5in x 3.5in) with a page break between checks so a stack of
// checks prints one per page. The amount line uses the legal amount in words;
// the snapshots on the run freeze the check face at print time.
export default function CheckPrintView({ run, bankAccountName, accountHolderName, onClose }) {
  const checks = run?.checks || [];
  return (
    <div className="bg-white">
      <div className="mb-4 flex items-center justify-between gap-4 print:hidden">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-slate-500">Check run</p>
          <h2 className="text-xl font-black">
            {checks.length} check{checks.length === 1 ? "" : "s"} · {formatCents(run?.totalAmountCents)}
          </h2>
          <p className="text-sm text-slate-500">Run date {formatCheckDate(run?.runDate)}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm font-bold"
          >
            Close
          </button>
          <button
            onClick={() => window.print()}
            className="rounded-lg bg-slate-950 px-5 py-2 text-sm font-bold text-white"
          >
            Print checks
          </button>
        </div>
      </div>

      {checks.map((check, index) => (
        <section
          key={`${check.vendorPaymentId}-${check.seq}`}
          aria-label={`Check ${check.checkNumber} to ${check.payeeName}`}
          className="mb-8 border border-slate-300 bg-white p-6 print:mb-0 print:border-0 print:p-0"
          style={{ width: "8.5in", maxWidth: "100%", minHeight: "3.5in", pageBreakAfter: index < checks.length - 1 ? "always" : "auto" }}
        >
          <div className="flex items-start justify-between">
            <div className="text-sm leading-tight">
              <p className="font-bold">{accountHolderName || "—"}</p>
              <p className="text-slate-500">{bankAccountName || ""}</p>
            </div>
            <div className="text-right text-sm leading-tight">
              <p className="font-bold">Check no. {check.checkNumber}</p>
              <p>{formatCheckDate(check.paymentDate)}</p>
            </div>
          </div>

          <div className="mt-6 flex items-end gap-3">
            <p className="text-sm uppercase tracking-wide text-slate-500">Pay to the<br />order of</p>
            <p className="flex-1 border-b border-slate-800 pb-1 text-lg font-bold">{check.payeeName}</p>
            <p className="border border-slate-800 px-3 py-1 font-mono text-lg font-bold">{formatCents(check.amountCents)}</p>
          </div>

          <div className="mt-3 flex items-end gap-3">
            <p className="flex-1 border-b border-slate-800 pb-1 text-sm italic">{amountCentsToWords(check.amountCents)}</p>
            <p className="text-sm uppercase tracking-wide text-slate-500">Dollars</p>
          </div>

          <div className="mt-6 flex items-end justify-between gap-8">
            <div className="flex-1">
              <p className="text-sm uppercase tracking-wide text-slate-500">Memo</p>
              <p className="border-b border-slate-800 pb-1 text-sm">{check.memo || ""}</p>
            </div>
            <div className="w-64">
              <p className="border-b border-slate-800 pb-4 text-sm">&nbsp;</p>
              <p className="text-xs uppercase tracking-wide text-slate-500">Authorized signature</p>
            </div>
          </div>

          <p className="mt-4 font-mono text-xs text-slate-400 print:hidden">
            Payment {check.vendorPaymentId} · printed {new Date().toLocaleString()}
          </p>
        </section>
      ))}

      {checks.length === 0 && (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-slate-500">
          This run has no checks.
        </p>
      )}
    </div>
  );
}
