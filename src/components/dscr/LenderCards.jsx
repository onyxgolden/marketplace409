"use client";

import { useState } from "react";
import { nmlsConsumerAccessUrl, isTermsStale } from "@/lib/dscr/listings";

function Claimed({ children }) {
  return (
    <span className="inline-block bg-amber-100 text-amber-900 text-xs font-semibold px-2 py-0.5 rounded-full ml-2 align-middle">
      provider-claimed
    </span>
  );
}

export function LenderCard({ lender }) {
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState(null);
  const [reportSending, setReportSending] = useState(false);
  const stale = isTermsStale(lender.last_provider_confirmed_at);

  const asOf = lender.terms_as_of_date
    ? new Date(lender.terms_as_of_date + "T12:00:00Z").toLocaleDateString()
    : null;

  async function submitReport(e) {
    e.preventDefault();
    if (!reportReason.trim() || reportSending) return;
    setReportSending(true);
    setReportError(null);
    try {
      const res = await fetch("/api/dscr-lenders/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lender_id: lender.id, reason: reportReason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Fail closed: never display "recorded" on a failed request.
        setReportError(
          body.error || "Could not send the report. Please try again."
        );
        return;
      }
      setReportDone(true);
    } catch {
      setReportError("Could not send the report. Please try again.");
    } finally {
      setReportSending(false);
    }
  }

  return (
    <article className="bg-white rounded-2xl shadow p-6 flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-extrabold">{lender.company_name}</h2>
        {stale && (
          <span className="shrink-0 bg-orange-100 text-orange-900 text-xs font-bold px-2 py-1 rounded">
            Terms may be outdated
          </span>
        )}
      </div>

      <div className="mt-3 text-sm space-y-1.5">
        <p>
          <span className="font-semibold">NMLS:</span> {lender.nmls_number}{" "}
          <a
            href={nmlsConsumerAccessUrl(lender.nmls_number)}
            target="_blank"
            rel="noopener noreferrer external"
            className="text-green-700 underline text-xs"
          >
            Verify on NMLS Consumer Access (external)
          </a>
        </p>
        <p className="text-xs text-gray-500">
          Identity review: {lender.identity_review_status}
          {lender.last_directory_reviewed_at &&
            ` · reviewed ${new Date(lender.last_directory_reviewed_at).toLocaleDateString()}`}
          {lender.last_provider_confirmed_at &&
            ` · provider confirmed ${new Date(lender.last_provider_confirmed_at).toLocaleDateString()}`}
        </p>

        {lender.states_served?.length > 0 && (
          <p>
            <span className="font-semibold">States:</span>{" "}
            {lender.states_served.join(", ")}
            <Claimed />
          </p>
        )}
        {(lender.min_loan_amount != null || lender.max_loan_amount != null) && (
          <p>
            <span className="font-semibold">Loan size:</span>{" "}
            {lender.min_loan_amount != null
              ? `$${Number(lender.min_loan_amount).toLocaleString()}`
              : "—"}{" "}
            –{" "}
            {lender.max_loan_amount != null
              ? `$${Number(lender.max_loan_amount).toLocaleString()}`
              : "—"}
            <Claimed />
          </p>
        )}
        {lender.property_types?.length > 0 && (
          <p>
            <span className="font-semibold">Property types:</span>{" "}
            {lender.property_types.join(", ")}
            <Claimed />
          </p>
        )}
        {lender.transaction_types?.length > 0 && (
          <p>
            <span className="font-semibold">Transactions:</span>{" "}
            {lender.transaction_types.join(", ")}
            <Claimed />
          </p>
        )}
        {lender.min_dscr_accepted != null && (
          <p>
            <span className="font-semibold">Min DSCR:</span>{" "}
            {Number(lender.min_dscr_accepted).toFixed(2)}x<Claimed />
          </p>
        )}
        {lender.max_ltv != null && (
          <p>
            <span className="font-semibold">Max LTV:</span>{" "}
            {Number(lender.max_ltv)}%<Claimed />
          </p>
        )}
        {lender.min_credit_score_claim != null && (
          <p>
            <span className="font-semibold">Min credit score:</span>{" "}
            {lender.min_credit_score_claim}<Claimed />
          </p>
        )}
        {lender.prepayment_penalty_availability && (
          <p>
            <span className="font-semibold">Prepayment penalty:</span>{" "}
            {lender.prepayment_penalty_availability}
            <Claimed />
          </p>
        )}
        {lender.occupancy_entity_restrictions && (
          <p>
            <span className="font-semibold">Restrictions:</span>{" "}
            {lender.occupancy_entity_restrictions}
            <Claimed />
          </p>
        )}
        {asOf && (
          <p className="text-xs text-gray-500">Terms as of {asOf}.</p>
        )}
      </div>

      <div className="mt-4 pt-4 border-t flex flex-wrap gap-2 items-center">
        {lender.application_url && (
          <a
            href={lender.application_url}
            target="_blank"
            rel="noopener noreferrer external"
            className="bg-green-700 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-green-600"
          >
            Visit lender site (external)
          </a>
        )}
        {(lender.contact_phone || lender.contact_email) && (
          <p className="text-sm text-gray-600">
            {lender.contact_phone && <span>{lender.contact_phone}</span>}
            {lender.contact_phone && lender.contact_email && <span> · </span>}
            {lender.contact_email && <span>{lender.contact_email}</span>}
            <Claimed />
          </p>
        )}
        <button
          type="button"
          onClick={() => setShowReport((v) => !v)}
          className="ml-auto text-xs text-gray-500 underline"
        >
          Report a problem
        </button>
        <a
          href={`/investors/dscr-loans/edit/${lender.id}`}
          className="text-xs text-gray-500 underline"
        >
          Propose edit
        </a>
      </div>

      {showReport && !reportDone && (
        <form onSubmit={submitReport} className="mt-3 text-sm">
          <label className="block font-semibold text-xs">
            What&apos;s wrong with this listing?
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1"
              rows={2}
              required
              minLength={10}
              maxLength={2000}
            />
          </label>
          {reportError && (
            <p className="mt-2 text-xs text-red-700" role="alert">
              {reportError}
            </p>
          )}
          <button
            type="submit"
            disabled={reportSending}
            className="mt-2 bg-gray-800 text-white px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
          >
            {reportSending ? "Sending…" : "Send report"}
          </button>
          <p className="mt-1 text-xs text-gray-500">
            Reporting requires signing in. One report per listing per day.
          </p>
        </form>
      )}
      {reportDone && (
        <p className="mt-3 text-xs text-green-700">
          Thanks — your report was recorded for directory review.
        </p>
      )}
    </article>
  );
}

export function LenderFilters({ filters, setFilters }) {
  const set = (k) => (e) =>
    setFilters((f) => ({ ...f, [k]: e.target.value || undefined }));
  const inputClass =
    "border border-gray-300 rounded-lg px-3 py-2 text-sm w-full";

  return (
    <div className="bg-white rounded-2xl shadow p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
      <label className="text-xs font-semibold">
        State
        <input
          value={filters.state ?? ""}
          onChange={set("state")}
          placeholder="TX"
          maxLength={2}
          className={inputClass + " mt-1"}
          aria-label="Filter by state"
        />
      </label>
      <label className="text-xs font-semibold">
        Min loan $
        <input
          type="number"
          min="0"
          value={filters.minLoan ?? ""}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              minLoan: e.target.value ? Number(e.target.value) : undefined,
            }))
          }
          className={inputClass + " mt-1"}
          aria-label="Filter by minimum loan amount"
        />
      </label>
      <label className="text-xs font-semibold">
        Max loan $
        <input
          type="number"
          min="0"
          value={filters.maxLoan ?? ""}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              maxLoan: e.target.value ? Number(e.target.value) : undefined,
            }))
          }
          className={inputClass + " mt-1"}
          aria-label="Filter by maximum loan amount"
        />
      </label>
      <label className="text-xs font-semibold">
        Property type
        <select
          value={filters.propertyType ?? ""}
          onChange={set("propertyType")}
          className={inputClass + " mt-1"}
          aria-label="Filter by property type"
        >
          <option value="">Any</option>
          <option value="SFR">Single-family</option>
          <option value="2-4 unit">2–4 unit</option>
          <option value="5+ unit">5+ unit</option>
        </select>
      </label>
      <label className="text-xs font-semibold">
        Transaction
        <select
          value={filters.transactionType ?? ""}
          onChange={set("transactionType")}
          className={inputClass + " mt-1"}
          aria-label="Filter by transaction type"
        >
          <option value="">Any</option>
          <option value="purchase">Purchase</option>
          <option value="rate-term refinance">Rate-term refinance</option>
          <option value="cash-out refinance">Cash-out refinance</option>
        </select>
      </label>
    </div>
  );
}
